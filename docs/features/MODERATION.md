# Moderation

Phase 1 of the moderation suite (LYRA-7 / LYRA-8): core actions, cases, timed actions and a mod-action log.
Every command works as a slash command and with the `%` prefix.

## Permissions

Each command checks three things, in this order:

1. **Discord permission** for the moderator (table below). Slash commands are also hidden from members without it.
2. **`/permissions` role gates**, like every other command (`/permissions set command:ban role:@Mods`, or per subcommand, e.g. `case delete`).
3. **Role hierarchy**: the target's top role must be below both the moderator's and Lyra's. The server owner outranks everyone, but Lyra still can't act above her own top role. `/role` also refuses roles at or above either top role, `@everyone` and integration-managed roles.

The bot needs the same Discord permission as the moderator; `/lock` and `/unlock` also need **Manage Roles** (to edit channel overwrites).

| Command                           | Permission       |
| --------------------------------- | ---------------- |
| `/warn`, `/timeout`, `/untimeout` | Moderate Members |
| `/kick`                           | Kick Members     |
| `/ban`, `/unban`, `/softban`      | Ban Members      |
| `/purge`                          | Manage Messages  |
| `/slowmode`, `/lock`, `/unlock`   | Manage Channels  |
| `/nick`                           | Manage Nicknames |
| `/role add`, `/role remove`       | Manage Roles     |
| `/case`, `/modlogs`, `/note`      | Moderate Members |
| `/modconfig`                      | Manage Server    |

No privileged gateway intents are needed for this phase.

## Commands

Durations look like `10m`, `2h`, `7d`, `1w`, `1h30m` (units s, m, h, d, w).

| Command                                                                         | Prefix form                                                                         | Notes                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/warn user reason`                                                             | `%warn @user <reason>`                                                              | Stored as a case.                                                                                                                                           |
| `/timeout user duration [reason]`                                               | `%timeout @user 10m [reason]`                                                       | Discord's native timeout, max 28 days.                                                                                                                      |
| `/untimeout user [reason]`                                                      | `%untimeout @user [reason]`                                                         |                                                                                                                                                             |
| `/kick user [reason]`                                                           | `%kick @user [reason]`                                                              |                                                                                                                                                             |
| `/ban user [reason] [duration] [delete_messages]`                               | `%ban @user [7d] [reason] [--delete=1d]`                                            | Works on users who aren't in the server. A duration makes it a temp-ban that lifts itself. A later permanent ban cancels the timer.                         |
| `/unban user [reason]`                                                          | `%unban <id> [reason]`                                                              | Also cancels a pending temp-ban expiry.                                                                                                                     |
| `/softban user [reason] [delete_messages]`                                      | `%softban @user [reason] [--delete=1d]`                                             | Ban + immediate unban to clear their messages (24 h by default).                                                                                            |
| `/purge count [user] [bots] [links] [attachments] [embeds] [contains] [reason]` | `%purge 50 [@user] [--bots] [--links] [--attachments] [--embeds] [--contains=text]` | Deletes up to 100. With filters it searches the last 500 messages. Pinned messages and anything 14+ days old are skipped (Discord can't bulk-delete those). |
| `/slowmode duration [channel] [reason]`                                         | `%slowmode [#channel] <5s\|off>`                                                    | Max 6 h.                                                                                                                                                    |
| `/lock [channel] [server] [reason]`                                             | `%lock [#channel\|server] [reason]`                                                 | Denies @everyone Send Messages, Send in Threads and Create Threads. `server` locks every text/announcement/forum channel @everyone can currently talk in.   |
| `/unlock [channel] [server] [reason]`                                           | `%unlock [#channel\|server]`                                                        | Restores the exact @everyone overwrite Lyra replaced. `server` only reopens channels Lyra locked, so channels that were read-only before stay that way.     |
| `/nick user [nickname] [reason]`                                                | `%nick @user <name\|reset>`                                                         | Omit the nickname to reset.                                                                                                                                 |
| `/role add user role [duration] [reason]`                                       | `%role add @user @role [1d] [reason]`                                               | A duration makes it a timed role. Re-adding restarts the timer.                                                                                             |
| `/role remove user role [reason]`                                               | `%role remove @user @role [reason]`                                                 | Cancels any timer for that role.                                                                                                                            |
| `/case view\|edit-reason\|delete number`                                        | `%case view 12`                                                                     | Editing a reason also updates the mod-log message. Deleting removes the record only; it doesn't undo the action.                                            |
| `/modlogs user`                                                                 | `%modlogs @user`                                                                    | Cases (newest first), pending timed actions and a note count.                                                                                               |
| `/note add\|list user`, `/note remove id`                                       | `%note add @user <text>`                                                            | Private to moderators; never DMed.                                                                                                                          |
| `/modconfig view`                                                               | `%modconfig view`                                                                   |                                                                                                                                                             |
| `/modconfig log-channel [channel]`                                              | `%modconfig log-channel #mod-log\|clear`                                            | Omit the channel to turn the log off.                                                                                                                       |
| `/modconfig dm action enabled`                                                  | `%modconfig dm ban off`                                                             | Per action: warn, timeout, untimeout, kick, ban, softban. All on by default.                                                                                |

`/modconfig` changes are recorded in the config audit log (dashboard **Audit** tab, section 🛡️ Moderation).

## Cases

Every action creates a case with a per-server number (`mod_cases`). Numbers are never reused: deleting case 5 leaves a gap.
User actions, channel actions (purge, slowmode, lock) and server lockdowns are all cases; `target_type` says which.

If the action fails (Discord refuses, missing permission), its case is removed again.

## DMs

When DMs are on for an action, the target gets a DM with the server name, the action, the duration, the reason and the case number.
The DM is sent _before_ a kick or ban, because afterwards Lyra usually shares no server with them. Closed DMs are normal; the reply just won't say "DM sent".
Banning someone who isn't in the server never DMs.

## Timed actions

Temp-ban expiry and timed-role removal are stored in `mod_scheduled_actions` and checked every 30 seconds, so they survive restarts (an overdue action runs on the first check after boot).
Each expiry creates its own case (moderator: Lyra). If the ban or member is already gone, the entry is dropped. Other failures retry every minute, up to 5 attempts.
Timeouts don't need the scheduler: Discord lifts them itself.

## Tables

| Table                   | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `mod_case_counter`      | Last case number per guild                                    |
| `mod_cases`             | Cases                                                         |
| `mod_notes`             | Private notes                                                 |
| `mod_scheduled_actions` | Pending temp-ban expiries and timed-role removals             |
| `mod_config`            | Log channel and DM-on-action list                             |
| `mod_locked_channels`   | Channels Lyra locked, with the @everyone overwrite to restore |
