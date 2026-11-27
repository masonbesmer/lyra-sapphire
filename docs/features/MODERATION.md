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

## Phase 5: anti-raid, reports, tickets, appeals, voice (LYRA-12)

### Voice moderation

| Command                        | Prefix form                    | Permission     | Notes                                                     |
| ------------------------------ | ------------------------------ | -------------- | --------------------------------------------------------- |
| `/vmute user [reason]`         | `%vmute @user [reason]`        | Mute Members   | Toggle: server-mutes, or unmutes if already muted.        |
| `/vdeafen user [reason]`       | `%vdeafen @user [reason]`      | Deafen Members | Toggle, like `/vmute`.                                    |
| `/vkick user [reason]`         | `%vkick @user [reason]`        | Move Members   | Disconnects them from voice.                              |
| `/vmove user channel [reason]` | `%vmove @user #voice [reason]` | Move Members   | The moderator must be able to connect to the destination. |

The target has to be in voice. Role hierarchy applies as for the other commands. Each action is a case (`vmute`, `vunmute`, `vdeafen`, `vundeafen`, `vkick`, `vmove`). No DM.

### Mod queue settings: `/modqueue` (Manage Server)

| Command                                    | Prefix form                                     | What it does                                                                                             |
| ------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/modqueue view`                           | `%modqueue view`                                |                                                                                                          |
| `/modqueue reports [channel]`              | `%modqueue reports #queue\|off`                 | Where `/report` goes. Omit the channel to turn reports off.                                              |
| `/modqueue tickets [channel] [staff_role]` | `%modqueue tickets #support [@Staff]\|off`      | Text channel that holds ticket threads, and the role pinged into each one.                               |
| `/modqueue appeals [channel] [url]`        | `%modqueue appeals [#appeals] [https://…]\|off` | Built-in appeal form (posts to the channel) and/or a link to an outside form. Both are shown in ban DMs. |

Changes are recorded in the config audit log (section 🛡️ Moderation).

### Reports

- `/report user reason`, or right-click a message → **Apps → Report message** (asks for a reason). Anyone can report; the answer is always private. `%report @user reason` deletes the command message and answers by DM.
- The report lands in the queue channel with the reporter, the reason and, for message reports, a copy of the message (it may get deleted) and a jump link.
- Buttons: **Warn**, **Timeout 1h** (both create a normal case and DM per `/modconfig dm`), **Delete message**, **Resolve**, **Dismiss**. They need Moderate Members (Delete needs Manage Messages) and check role hierarchy. A report can only be closed once, so two moderators can't both act on it.
- Limits: 5 reports per member per 10 minutes, and no duplicate open report on the same message.
- Buttons check the clicker's Discord permission, not `/permissions` role gates (those only apply to commands).

### Tickets / modmail

- `/ticket open [subject]`, the **Open a ticket** button (`/ticket panel [channel]`, Manage Server), or a DM to Lyra. A DM gets a prompt listing the shared servers that take tickets; nothing reaches staff until the member presses a server button, and the DM becomes the ticket's first message. DMs that look like commands (`%…`, `lyra, …`) are ignored, and the prompt is sent at most once a minute.
- Each ticket is a private thread in the ticket channel with the member, and the staff role mentioned (which adds role members who can see the channel). One open ticket per member; opening again returns the existing thread.
- `/ticket close [reason]` or the **Close ticket** button: the member who opened it, the staff role, or anyone with Manage Threads. Closing locks and archives the thread.
- Lyra needs **Create Private Threads**, **Send Messages in Threads** and **Manage Threads** in the ticket channel.

### Ban appeals

- When appeals are on, the ban DM carries an **Appeal this ban** button (built-in form) and/or an **Appeal form** link. The DM is sent before the ban, so it reaches the member. Only `/ban` and temp-bans send it (not softban).
- The button opens a form (20–1500 characters). Lyra checks the member really is banned, that they have no appeal pending, and that a denial wasn't in the last 7 days.
- The appeal is posted to the appeal channel with the ban reason and **Accept (unban)** / **Deny** buttons (Ban Members). Accepting unbans with a case and cancels a pending temp-ban expiry. The member gets a DM with the decision when Discord allows it.

### Anti-raid: `/antiraid` (Manage Server)

> **Needs the Server Members intent.** Lyra only sees joins with this privileged intent. It is opt-in: turn on **Server Members Intent** in the Developer Portal (Bot tab), then set `DISCORD_MEMBERS_INTENT=true` and restart. Setting the env var without the portal toggle stops the bot from logging in. Without it, the raid trigger and join screening do nothing (`/antiraid view` says so); the verification button still works.

| Subcommand                                     | What it does                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/antiraid view`                               | Settings, and whether raid mode is on.                                                             |
| `/antiraid set …`                              | Change any of the settings below; only the options you give change. `clear` unsets a channel/role. |
| `/antiraid verification channel [role] [mode]` | Posts the **Verify** button and sets the role it grants and the mode (`button` or `captcha`).      |
| `/antiraid end`                                | Ends raid mode now and unlocks what it locked.                                                     |

Prefix: `%antiraid view|end`, `%antiraid set enabled on join_threshold 8 join_window 15s …`, `%antiraid verification #verify @Member captcha`.

| Setting                                  | Default                | Meaning                                                                                        |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `enabled`                                | off                    | Master switch.                                                                                 |
| `join_threshold` / `join_window`         | 10 in 10s              | This many joins inside the window starts raid mode (3–100, 5s–10m).                            |
| `lockdown`                               | on                     | Raid mode locks the server like `/lock server` (a case by Lyra) and unlocks it when it ends.   |
| `raid_action`                            | quarantine             | What happens to members who join during raid mode: none, quarantine, kick, ban.                |
| `raid_duration`                          | 15m                    | Raid mode ends by itself after this (1m–24h). Stored, so it survives a restart.                |
| `alert_channel` / `alert_role`           | mod-log channel / none | Where the raid alert (with an **End raid mode** button, Manage Server) goes, and who it pings. |
| `min_account_age` / `account_age_action` | off / quarantine       | Accounts younger than this get the action.                                                     |
| `default_avatar_action`                  | none                   | What happens to members with no profile picture.                                               |
| `quarantine_role`                        | none                   | The role quarantine adds. Set up its channel permissions yourself (e.g. only see #verify).     |
| `quarantine_on_join`                     | off                    | Quarantine every new member until they verify.                                                 |

When several rules match, the harshest action wins (ban > kick > quarantine). Bots are never screened. Outside raid mode each screened join gets a line in the alert channel; during raid mode the end-of-raid message gives the count. Kicks and bans by anti-raid are cases by Lyra.

**Verification:** pressing **Verify** grants the verify role (if set) and removes the quarantine role. In `captcha` mode the member is shown a 5-character code privately and types it into a form (one try per code, 5 minutes). Verification is paused during raid mode.

### Tables (phase 5)

| Table              | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `mod_queue_config` | Report, ticket and appeal channels, staff role and appeal link  |
| `mod_reports`      | Reports and how they were handled                               |
| `mod_tickets`      | Ticket threads (one open per member and server)                 |
| `mod_appeals`      | Ban appeals and decisions                                       |
| `antiraid_config`  | Anti-raid and verification settings, plus the current raid mode |
