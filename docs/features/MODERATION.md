# Moderation

The moderation suite (LYRA-7). Phase 1 (LYRA-8): core actions, cases, timed actions and a mod-action log.
Phase 3 (LYRA-10): [event logging](#event-logging) and [cases for actions taken outside Lyra](#actions-taken-outside-lyra).
Phase 2 (LYRA-9): [self-assign roles](#self-assign-roles) (role panels, auto-role, sticky roles).
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
| `/modconfig`, `/logconfig`        | Manage Server    |
| `/roles`                          | Manage Roles     |

Phase 1 needs no privileged intents. Phases 2 and 3 use **GuildMembers** (privileged: turn on **Server Members Intent** in the Developer Portal for each app, or Discord refuses the login), plus GuildModeration, GuildInvites and GuildExpressions (not privileged). Phase 4 (AutoMod) adds the non-privileged Auto Moderation Execution intent.

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
| `role_panels`           | Role panels (message, kind, mode)                             |
| `role_panel_entries`    | The roles on each panel, with emoji and label                 |
| `auto_roles`            | Roles given on join, per humans/bots                          |
| `sticky_role_config`    | Which roles are sticky                                        |
| `sticky_role_holds`     | Sticky roles a member held when they left                     |
| `log_routes`            | Event → log channel, per guild                                |
| `log_ignores`           | Channels and users the event log skips                        |

## Self-assign roles

Everything is under `/roles` (Manage Roles, for the moderator and Lyra). Changes to auto-roles and sticky roles go in the config audit log (section 🛡️ Moderation).

### Role panels

A panel is one message people use to give themselves roles. Three kinds share one backend:

| Kind       | How members pick                                      | Limit    |
| ---------- | ----------------------------------------------------- | -------- |
| `button`   | A button per role (default, no reaction perms needed) | 25 roles |
| `select`   | A dropdown menu                                       | 25 roles |
| `reaction` | React with the role's emoji; works on any message     | 20 roles |

| Mode     | Effect                                                             |
| -------- | ------------------------------------------------------------------ |
| `normal` | Add and remove freely (click again / unreact / deselect to remove) |
| `unique` | One role from the panel at a time; picking another swaps it        |
| `verify` | Add only (e.g. "I accept the rules"); unreacting doesn't remove it |
| `drop`   | Remove only                                                        |

| Command                                                                     | Prefix form                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/roles panel create kind [mode] [channel] [title] [description] [message]` | `%roles panel create button [unique] [#channel\|message link] [title]` |
| `/roles panel add panel role [emoji] [label]`                               | `%roles panel add 3 @Role [🎮] [label]`                                |
| `/roles panel remove panel role`                                            | `%roles panel remove 3 @Role`                                          |
| `/roles panel mode panel mode`                                              | `%roles panel mode 3 unique`                                           |
| `/roles panel list`, `/roles panel delete panel`                            | `%roles panel list`                                                    |

- `create` posts an embed and prints the panel number. For a reaction panel, `message` (a message link) uses an existing message instead, e.g. your rules post. Lyra never edits a message she didn't post; she only adds her reactions to it.
- `add` again on a role already on the panel changes its emoji or label. Reaction panels need an emoji per role (unicode, or a custom emoji Lyra can use).
- Removing a role from a panel, or deleting the panel, doesn't take the role from members who have it.
- Deleting a Discord role removes it from every panel automatically.

**Which roles are allowed:** the moderator must outrank the role (same rule as `/role`), Lyra must too, and the role must not be `@everyone`, integration-managed, or carry moderator permissions (Administrator, Manage Server/Roles/Channels/Messages/Nicknames/Webhooks/Expressions/Events/Threads, Kick, Ban, Timeout, Mention @everyone, View Audit Log, Move/Mute/Deafen Members). This is checked when the role is added and again on every click, so a role that later gains such a permission stops being handed out.

Button and menu IDs carry the panel and role, but Lyra re-checks both against the database: a forged ID can't hand out a role that isn't on that panel.

### Auto-role and sticky roles

| Command                                                | Prefix form                          |
| ------------------------------------------------------ | ------------------------------------ |
| `/roles autorole add\|remove role [for:humans\|bots]`  | `%roles autorole add @Member [bots]` |
| `/roles autorole list`                                 | `%roles autorole list`               |
| `/roles sticky add\|remove role`, `/roles sticky list` | `%roles sticky add @Muted`           |

- **Auto-role**: new members get the human list, bots get the bot list (up to 10 each). With membership screening on, humans get theirs once they accept the rules. Same role restrictions as panels.
- **Sticky roles**: when someone leaves while holding a sticky role, Lyra remembers it and puts it back when they rejoin, so leaving doesn't shake off a mute role. The restore is logged as a case (moderator: Lyra). A timed role (`/role add … 1d`) that runs out while they're away is not restored. Sticky roles may carry permissions, since they only return to someone who already had them. Up to 25.

**Needs the Server Members intent** (privileged, requested since phase 3): join and leave events only arrive with it. Turn on **Server Members Intent** in the Developer Portal for each app before deploying, or Discord refuses the login. Lyra caches the member list of servers that use sticky roles at startup (and when a sticky role is added), so she knows who held what when they leave.

## Event logging

`/logconfig` (Manage Server) sends each event type to its own channel. Route a whole group at once, or one event at a time.

| Group      | Events                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `messages` | `message_edit` (before/after), `message_delete` (content, attachments), `message_bulk_delete`            |
| `members`  | `member_join` (account age, invite used), `member_leave`, `member_nick`, `member_roles`, `member_avatar` |
| `voice`    | `voice_join`, `voice_leave`, `voice_move`                                                                |
| `server`   | `channel_changes`, `role_changes`, `emoji_changes`, `server_changes`                                     |

| Command                              | Prefix form                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `/logconfig view`                    | `%logconfig view`                                          |
| `/logconfig channel event [channel]` | `%logconfig channel <event\|group\|all> [#channel\|clear]` |
| `/logconfig ignore channel\|user`    | `%logconfig ignore <#channel\|@user>`                      |
| `/logconfig unignore channel\|user`  | `%logconfig unignore <#channel\|@user>`                    |

- Omit the channel to stop logging an event. Lyra needs View Channel, Send Messages, Embed Links and Attach Files there.
- **Ignored channels** cover their threads, and an ignored category covers its channels. They apply to message, voice and channel events. **Ignored users** apply to message, member and voice events.
- Always skipped: messages from bots and webhooks, voice activity of bots (music bots come and go all the time), and messages in any log channel or the mod log.
- Edits only log when the text changed (link previews loading don't count). Channel and role updates skip position-only changes (dragging one role reorders all the ones below it).
- A message that was sent before Lyra started (so isn't cached) logs as "not cached": Discord doesn't send deleted content.
- A bulk delete (including `/purge`) attaches a `.txt` transcript of the messages that were cached.
- **Invite used** compares invite use counts before and after the join, so Lyra needs **Manage Server** to read invites. If two people join at once, or the server's vanity URL was used, it says so or shows "unknown" rather than guessing.
- An avatar change logs the server avatar (per server) and the profile avatar (in every server that shares the member).
- Changes to `/logconfig` are in the config audit log, section 🛡️ Moderation (`log.<event>`, `log_ignore.<channel|user>`).

## Actions taken outside Lyra

A ban, unban, kick or timeout made in Discord itself (right-click → Ban, etc.) or by another bot becomes a case like any other: numbered, shown in `/modlogs`, and posted to the mod log. The moderator is whoever Discord's audit log names, and the reason is the audit-log reason. No DM is sent: Lyra didn't take the action, and by the time she hears of a kick or ban she usually can't reach them anyway.
Lyra's own actions are not doubled: anything she did herself is skipped, because her command opened the case already.
This needs **View Audit Log** for Lyra and the GuildModeration intent.

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

> Join screening and the raid trigger use the **Server Members** intent that phase 3 added (see [Permissions](#permissions)). No new intents in this phase.

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

**Auto-roles and sticky roles (phase 2):** while anti-raid is on, members who are quarantined or about to be screened don't get auto-roles on join; they get them when they pass verification. Don't make the auto-role the same role verification grants unless you want everyone in without verifying.

**Verification:** pressing **Verify** grants the verify role (if set) and removes the quarantine role. In `captcha` mode the member is shown a 5-character code privately and types it into a form (one try per code, 5 minutes). Verification is paused during raid mode.

### Tables (phase 5)

| Table              | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `mod_queue_config` | Report, ticket and appeal channels, staff role and appeal link  |
| `mod_reports`      | Reports and how they were handled                               |
| `mod_tickets`      | Ticket threads (one open per member and server)                 |
| `mod_appeals`      | Ban appeals and decisions                                       |
| `antiraid_config`  | Anti-raid and verification settings, plus the current raid mode |
