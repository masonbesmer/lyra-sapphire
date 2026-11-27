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

No privileged gateway intents are needed for this phase. AutoMod (below) adds the non-privileged Auto Moderation Execution intent.

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

## AutoMod

Phase 4 (LYRA-11). `/automod` needs **Manage Server**; Lyra needs **Manage Messages** to delete, plus Moderate/Kick/Ban Members for those actions and **Manage Server** for native sync.
Every filter is off until turned on. Server owners, administrators, bots and webhooks are never filtered.

| Filter        | Catches                                                                      | Settings (default)                                                           |
| ------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `phishing`    | Known phishing/scam domains, Discord/Steam lookalikes (`dlscord-nitro.gift`) | Extra domains via `/automod list` · action **ban**                           |
| `words`       | Banned words (whole word, case-insensitive, `*` wildcard) and `/regex/`      | List via `/automod list`                                                     |
| `invites`     | Discord invite links                                                         | Allowed invite codes via `/automod list`                                     |
| `links`       | Links by domain (subdomains included)                                        | `link_mode` block (listed domains) or allow (only these)                     |
| `attachments` | Files by extension                                                           | `exe scr bat cmd com msi pif vbs vbe js jse wsf ps1 jar apk lnk hta cpl dll` |
| `mentions`    | Too many distinct user/role mentions (+1 for @everyone/@here)                | limit 5                                                                      |
| `zalgo`       | Stacked combining marks                                                      | 5 in a row                                                                   |
| `caps`        | Mostly capitals (messages with 10+ letters; mentions, emoji, links ignored)  | 70 %                                                                         |
| `emoji`       | Too many emoji (unicode and custom)                                          | limit 10                                                                     |
| `duplicates`  | The same text from one member                                                | 3 in 30 s                                                                    |
| `flood`       | Messages from one member                                                     | 6 in 5 s                                                                     |

Each filter has its own **action** (`log`, `delete`, `warn`, `timeout`, `kick`, `ban`; default `delete`), an optional duration (timeout length, default 10 m; or temp-ban length) and its own exempt roles and channels. Exempting a channel covers its threads.
When several filters match one message, the one with the harshest action wins.

- Every action except `log` deletes the message. Duplicates and floods delete the whole burst in that channel.
- `delete` posts a short "removed by AutoMod" notice that disappears after 6 s, and a mod-log entry (no case).
- `warn`/`timeout`/`kick`/`ban` create a case with Lyra as the moderator, DM the member (per `/modconfig dm`) and post to the mod log with the filter and the message. A member is punished at most once per 15 s, so a burst doesn't stack actions.
- If Lyra can't act on the member (role too high), the message is still deleted and the mod log says so.
- Content filters also re-check edited messages; duplicates/flood/attachments don't.

| Command                                                                                | Prefix form                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/automod view [filter]`                                                               | `%automod view [filter]`                                                  |
| `/automod configure filter [enabled] [action] [duration] [limit] [window] [link_mode]` | `%automod configure caps on timeout 5m limit=80`                          |
| `/automod list add\|remove\|show filter [value]`                                       | `%automod list add words scam*`                                           |
| `/automod exempt add\|remove filter\|all [role] [channel]`                             | `%automod exempt add all @Mods`                                           |
| `/automod native on\|off\|status`                                                      | `%automod native on`                                                      |
| `/automod test text`                                                                   | `%automod test some text` — which content filters would match (no action) |

### Native Discord AutoMod

`/automod native on` mirrors three filters into Discord's own AutoMod, which blocks a message before anyone sees it:

| Native rule (owned by Lyra) | From                                | Discord limits                                |
| --------------------------- | ----------------------------------- | --------------------------------------------- |
| `Lyra: banned words`        | `words` (plain entries and regexes) | 1000 words ≤ 60 chars, 10 regexes ≤ 260 chars |
| `Lyra: mention spam`        | `mentions` limit                    | max 50                                        |
| `Lyra: spam`                | `flood` or `duplicates` being on    | Discord's own spam detection; one per server  |

Native rules block the message and alert the mod-log channel. When one fires, Lyra applies the filter's own action (warn/timeout/kick/ban) as a case, so it still counts toward warn thresholds.
Lyra keeps them in step whenever the filters change, and deletes them on `native off`. Rules anyone else made are never touched. Entries over Discord's limits stay Lyra-only (the reply lists them).
This uses the non-privileged **Auto Moderation Execution** gateway intent.

### Phishing list

The phishing filter checks a shared list ([nikolaischunk/discord-phishing-links](https://github.com/nikolaischunk/discord-phishing-links), loaded on first use and refreshed every 12 h), a small built-in list, lookalike detection and the server's own extra domains.
Set `PHISHING_DOMAIN_LIST_URL` to use another list, or to an empty string to skip the download.

## Warn thresholds

`/warnconfig` (Manage Server) applies an action when a member reaches **exactly** N active warnings, from `/warn` or an AutoMod warn. With 3 → timeout and 5 → kick, the 4th warn does nothing extra.

| Command                                   | Prefix form                    |
| ----------------------------------------- | ------------------------------ |
| `/warnconfig view`                        | `%warnconfig view`             |
| `/warnconfig set count action [duration]` | `%warnconfig set 3 timeout 1h` |
| `/warnconfig remove count`                | `%warnconfig remove 3`         |
| `/warnconfig expiry [duration]`           | `%warnconfig expiry 30d\|off`  |

Actions: `timeout` (duration required, max 28 d), `kick`, `ban` (duration = temp-ban, omit for permanent). Up to 10 thresholds.
With an expiry, warnings older than that stop counting; the cases stay. The threshold action is its own case with Lyra as moderator, and the `/warn` reply says what happened.

### AutoMod tables

| Table                 | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `automod_rules`       | Per filter: on/off, action, duration, settings JSON, exemptions |
| `automod_settings`    | Native sync switch and server-wide exemptions                   |
| `mod_warn_thresholds` | Warn count → action                                             |
| `mod_warn_config`     | Warn expiry                                                     |

`/automod` and `/warnconfig` changes are recorded in the config audit log (section 🛡️ Moderation).
