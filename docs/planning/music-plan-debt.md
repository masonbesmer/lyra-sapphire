# Music Overhaul — Debt & Plan Discrepancies

Companion to [`music-plan.md`](./music-plan.md). Records where the shipped
implementation diverges from the plan, and why.

**Scope of this audit:** all seven phases, source-level review as of 2026-08-10
(`ccbe33c` for D1–D36, `7069c1e` for D37–D46). The first pass ran without
dependencies installed; the second pass (D37–D46) had `node_modules` available
and checked the shipped `@sapphire/plugin-api@8.3.1` type/runtime contracts
directly. Still no `tsc` run and no runtime testing behind any of it.

**Index:** D1–D9 Phase 2 · D10–D19 Phase 3 · D20 Phase 1 · D21–D22 Phase 4 ·
D23–D32 Phase 5 · D33–D35 Phase 6 · D36 Phase 7 · D37–D46 second pass
(Phase 5 auth/OAuth, deps, Phase 2 polish).

> **Plan doc is missing.** `docs/planning/music-plan.md` is deleted in the
> working tree (unstaged), so every `./music-plan.md` link below is currently
> broken. It still exists at `HEAD`. The untracked `docs/music.md` is _not_ a
> replacement — it's a market-survey of competitor bots with its own unrelated
> six-phase numbering. Restore the plan or update the links before treating
> either as authoritative.

**Triage — fix these first:**

| ID                                                                                     | What                                                                            | Why it's top of the list                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **[D37](#d37--requestauthdata-does-not-exist--the-entire-dashboard-api-fails-closed)** | Every route reads `request.auth.data`, which the plugin never sets              | The whole WebUI is non-functional: guild list always empty, every guild route 403s |
| **[D23](#d23--websocket-auth-is-not-actually-checked)**                                | WS accepts any `lyra_session` cookie value; `subscribe` never checks membership | Full auth bypass — leaks any guild's music state incl. requester user IDs          |
| **[D38](#d38--logout-does-not-log-out)**                                               | Logout clears an `HttpOnly` cookie from JS and never calls `/oauth/logout`      | Session survives logout; the Discord token is never revoked                        |
| **[D24](#d24--no-api-route-checks-the-dj-role)**                                       | No API route checks the DJ role                                                 | WebUI bypasses the entire Phase 2f permission model (masked today by D37)          |
| **[D10](#d10--play-history-is-only-recorded-sometimes)**                               | Play history usually isn't recorded                                             | Silently guts `/history`, stats, and the history API                               |
| **[D36](#d36--announce_tracks-is-a-write-only-setting)**                               | `announce_tracks` is never read                                                 | A shipped config toggle does nothing                                               |

---

## 0. Root cause of most divergence: wrong player library in the plan

The plan was written against **discord-player v7** (`queue.node.setVolume()`,
`queue.filters.ffmpeg.toggle()`, `queue.setRepeatMode()`). The bot actually runs
**Kazagumo 3.4.3 + Shoukaku 4.3.0 against a Lavalink node**.

Every API reference in the plan is therefore notional. The implementation
adapted correctly; the entries below are the places where that adaptation
changed _user-visible behavior_, not just the call signature.

**Action:** the plan doc should be corrected or annotated so future phases
aren't written against the wrong API again.

---

## 1. Open bugs

### D1 — `%search` silently dead-ends when there are fewer than 5 results

**File:** [`src/commands/music/search.ts:109`](../../src/commands/music/search.ts)
**Severity:** medium — user-facing, silent failure

The message-variant collector filter hardcodes `/^[1-5]$/`, but the prompt tells
the user to "Reply with a number 1-${tracks.length}". With 3 results, typing `4`
passes the filter and consumes the collector's `max: 1` slot, then hits
`if (!track) return;` — no reply is sent. Because `collected.size === 1`, the
`end` handler's "Selection timed out." branch is also skipped. The user gets no
feedback at all.

**Fix:** derive the regex from `tracks.length`, or validate the index inside
`collect` and reply with an error instead of returning.

### D2 — `/search` timeout message lands on the wrong message; menu never cleared

**File:** [`src/commands/music/search.ts:91`](../../src/commands/music/search.ts)
**Severity:** low — cosmetic, but leaves a live-looking dead control

`deferReply()` followed by `followUp()` puts the select menu on a _second_
message. The `end` handler calls `interaction.editReply(...)`, which targets the
original deferred reply. Result: "Selection timed out." appears on a different
message than the menu, and the menu's components are never stripped.

**Fix:** capture the followUp's message handle and edit that.

### D3 — `%pause` leaves the persistent player buttons stale

**File:** [`src/commands/music/pause.ts:40`](../../src/commands/music/pause.ts)
**Severity:** low — state desync between command and button UI

`chatInputRun` re-edits the cached player message so the ⏸️/▶️ button flips
(lines 24 and 29). `messageRun` omits this entirely, so after `%pause` the button
row still shows the previous state.

**Fix:** hoist the `getCachedMessage` / `buildPlayerRows` edit into a shared
private method and call it from both paths.

---

## 2. Unimplementable as specified (stack constraint)

### D4 — Filter set is 11 Lavalink presets, not the plan's 31 FFmpeg filters

**Plan:** §2c lists 31 FFmpeg filter names.
**Shipped:** [`src/lib/lavalinkFilters.ts:16`](../../src/lib/lavalinkFilters.ts)

Lavalink exposes a fixed filter set (equalizer, timescale, tremolo, vibrato,
karaoke, rotation, distortion, channelMix, lowPass) rather than an arbitrary
FFmpeg filter graph. The 31-name list cannot be honored on this stack.

Implemented: `8D`, `nightcore`, `vaporwave`, `bassboost_low`, `bassboost`,
`bassboost_high`, `tremolo`, `vibrato`, `karaoke` — plus `lowpass` and `soft`,
which are **not in the plan** and were added to fill out the set.

Not implementable without moving off Lavalink: `phaser`, `reverse`, `treble`,
`normalizer`, `surrounding`, `pulsator`, `subboost`, `flanger`, `gate`, `haas`,
`mcompand`, `lofi`, `earrape`, `chorus`, `chorus2d`, `chorus3d`, `fadein`, `dim`,
`softlimiter`, `compressor`, `expander`, `silenceremove`.

**Status:** accepted deviation. Update the plan's filter list to match reality.

---

## 3. Missing features (implementable, not done)

### D5 — `/loop` has no Autoplay mode

**Plan:** §2a — "Off / Track / Queue / **Autoplay**"
**Shipped:** [`src/commands/music/loop.ts:6`](../../src/commands/music/loop.ts) — `['off', 'track', 'queue']`

Kazagumo's `setLoop()` accepts only `none | track | queue`. Autoplay would need a
manual implementation: on `queueEnd`, search for a related track and enqueue it.

**Status:** genuinely missing. Not blocked by the stack — just not built.

### D6 — `/play` autocomplete shows the wrong secondary field

**Plan:** §2b — "Each choice shows `title — duration` as the name"
**Shipped:** [`src/commands/music/play.ts:28`](../../src/commands/music/play.ts) — `` `${t.title} — ${t.author}` ``

Duration is available as `t.length` and `formatDuration` already exists in
`src/lib/music.ts`. One-line fix if the plan's wording is authoritative;
arguably author is the more useful disambiguator.

### D7 — `/filter list` is not paginated

**Plan:** §2c — "paginated embed"
**Shipped:** single embed listing all 11 filters.

Moot at the current filter count. Becomes real if the filter set grows.

---

## 4. Intentional departures (no action needed)

### D8 — `/history` omits the `InVoiceWithBot` precondition

Plan §2 says "All use the `InVoiceWithBot` precondition", but §2f lists `history`
among the unrestricted, non-destructive commands. The implementation follows §2f
and lets users check history from any text channel without being in voice. This
is the better behavior; the plan contradicts itself.

Note that `lyrics`, `nowplaying`, `search`, and `queue` **do** carry
`InVoiceWithBot`, so `/lyrics <query>` still requires the caller to be in a voice
channel. Worth revisiting if that proves annoying.

---

## 5. Pre-existing, inherited by new code

### D9 — `deferReply()` + `followUp()` instead of `editReply()`

**Files:** `play.ts`, `lyrics.ts`, `search.ts`

Deferring and then calling `followUp` sends an _additional_ message and leaves
the original deferred response stuck showing the loading indicator. The correct
call is `editReply` for the first response.

This predates the music overhaul — it's in the earliest version of `play.ts` —
but `lyrics.ts` and `search.ts` copied it. Not a Phase 2 regression; flagged so
the pattern stops spreading.

---

## Phase 2 — verified correct (no debt)

- All 11 Phase 2a commands exist, each with both `chatInputRun` and `messageRun`.
- `DJOnly` is applied to **exactly** the 10 commands §2f names — skip, skipto,
  stop, remove, move, shuffle, loop, filter, volume, disconnect — and to no
  others.
- All three `checkDJPermission` bypasses are implemented, including the
  deleted-role graceful degrade required by the plan's Edge Cases section.
- The 18 EQ preset names match the plan's list exactly.
- `move.ts`'s remove-then-splice produces correct final positions in both
  directions (traced up-move and down-move; no off-by-one).
- `/config music dj-role` and its `clear` variant exist in both slash and message
  form.

---

# Phase 3 — Player Message & Button Enhancements

## 6. Open bugs

### D10 — Play history is only recorded _sometimes_

**File:** [`src/listeners/playerStart.ts:40`](../../src/listeners/playerStart.ts)
**Severity:** high — silently breaks a shipped feature
**Breaks:** Phase 3d, Phase 2e (`/history`, `/history stats`), Phase 5c
(`/api/guilds/[guild]/history`)

`addPlayHistory()` sits at the _end_ of `run()`, but the edit-in-place branch
returns early at line 40 and never reaches it:

```ts
if (latest && latest.id === previousMessage.id) {
	await previousMessage.edit({ content, embeds: [embed], components: rows });
	await storePlayerMessage(channel, previousMessage);
	return; // ← skips addPlayHistory() entirely
}
```

Traced behavior:

| Situation                                              | Path                    | History recorded? |
| ------------------------------------------------------ | ----------------------- | ----------------- |
| First track (no cached message)                        | send                    | ✅                |
| Next track, player message still the newest in channel | **edit → early return** | ❌                |
| Next track, someone chatted since                      | delete + send           | ✅                |

So on a quiet channel — the normal case for a music bot — only the first track of
each session is ever logged. History looks like it "sort of works", which is why
this survived review.

**Fix:** move the `addPlayHistory` block above the `if (previousMessage)` branch,
so it runs on every `playerStart` regardless of how the message is rendered.

### D11 — Stopping the player orphans the now-playing message with live buttons

**Files:** [`src/listeners/playerControls.ts:78`](../../src/listeners/playerControls.ts),
[`src/LyraClient.ts:114`](../../src/LyraClient.ts)
**Severity:** medium — user-visible "This interaction failed"

`deletePlayerMessage()` is only wired to the `playerEmpty` event
([`queueEnd.ts`](../../src/listeners/queueEnd.ts)). The `playerDestroy` handler
in `LyraClient.ts:114` only logs. Every path that calls `player.destroy()` —
the Stop button, `/stop`, `/disconnect` — therefore leaves the embed and both
button rows sitting in the channel, plus a stale `player_messages` DB row.

Clicking any of those orphaned buttons hits `playerControls.ts:27`
(`if (!player) return;`), which returns **without acknowledging the
interaction** — Discord then shows the user "This interaction failed."

**Fix:** two parts — (a) call `deletePlayerMessage` from a `playerDestroy`
listener; (b) make line 27 reply with an ephemeral "the player is no longer
active" instead of returning silently.

### D12 — The Lyrics button doesn't fetch lyrics

**File:** [`src/listeners/playerControls.ts:109`](../../src/listeners/playerControls.ts)
**Severity:** medium — advertised control is a stub

The 📜 button replies `"Use /lyrics to fetch lyrics for **X**."` — it tells the
user to run a different command rather than doing the thing. Plan §3b lists it
as a functional control.

Blocking detail: `fetchLyrics()` in
[`lyrics.ts:6`](../../src/commands/music/lyrics.ts) is module-private. Fixing
this properly means extracting `fetchLyrics` + `buildLyricsEmbed` into
`src/lib/music.ts` (or a `lib/lyrics.ts`) so both the command and the button can
call them.

### D13 — The filter select menu skips the DJ permission check

**File:** [`src/listeners/playerControls.ts:46`](../../src/listeners/playerControls.ts)
**Severity:** low — narrow window, but a real authorization gap

`destructiveIds` (line 30) gates `player_filters`, but the
`player_filter_select` handler runs _before_ the switch and its customId is not
in that list — so the toggle itself is never re-authorized.

Exploitable window: a user opens the menu while alone in voice (DJ check bypasses
when alone), others then join, and the still-open ephemeral menu keeps working
without the DJ role. Permission is checked when the menu is _opened_, never when
the action is _executed_.

**Fix:** run `checkDJPermission` inside the select-menu branch too.

### D14 — Dead button handlers

**File:** [`src/listeners/playerControls.ts:133-138`](../../src/listeners/playerControls.ts)
**Severity:** low — dead code

`player_seek_forward` and `player_seek_back` have handlers, but no button in
[`buildPlayerRows`](../../src/lib/playerButtons.ts) emits either customId. They
are unreachable. They also skip both `destructiveIds` and `updateNowPlaying()`,
so if they were ever wired up they'd be inconsistent with every sibling handler.

**Fix:** delete, or add the buttons deliberately.

### D15 — Skip repaints the embed with soon-to-be-stale state

**File:** [`src/listeners/playerControls.ts:57`](../../src/listeners/playerControls.ts)
**Severity:** low — cosmetic race

`player.skip()` triggers a `playerStart` for the next track asynchronously, and
that listener rebuilds the message itself. The immediate `updateNowPlaying()`
call renders whatever the player reports _right now_, which may still be the
outgoing track — a brief wrong-state flash before `playerStart` corrects it.

**Fix:** drop the `updateNowPlaying()` call from the skip case and let
`playerStart` own the repaint.

### D16 — Pause and Restart are ungated while Stop and Skip are not

**File:** [`src/listeners/playerControls.ts:30`](../../src/listeners/playerControls.ts)
**Severity:** low — policy inconsistency, flagging for a decision

`destructiveIds` covers skip, stop, shuffle, loop, vol_down, vol_up, filters. It
omits `player_pause` and `player_previous` — so any user in the voice channel can
pause playback or restart the current track for everyone, with no DJ role.

Omitting pause is at least _consistent_ with Phase 2 (the `/pause` command also
has no `DJOnly`, per plan §2f). `player_previous` is the odder one: restarting
the track disrupts every listener, and its Phase 2 analogue `/seek` is likewise
ungated. Plan §2f never classifies seek or previous either way.

**Decision needed:** is "disrupts playback for everyone" the DJ line, or only
"destroys queue state"? Current code implies the latter for pause/seek but the
former for shuffle/loop/volume.

### D17 — The listener's parameter type is wrong

**File:** [`src/listeners/playerControls.ts:13`](../../src/listeners/playerControls.ts)
**Severity:** low — type accuracy

`run(interaction: ButtonInteraction)` also receives and handles string select
menus (lines 14, 46–51, accessing `interaction.values`). The declared type is
narrower than reality; it should be `Interaction` (or a
`ButtonInteraction | StringSelectMenuInteraction` union), with the existing
guards doing the narrowing.

Not confirmed against `tsc` — dependencies weren't installed for this audit.

---

## 7. Phase 3 spec deviations

### D18 — Loop button never shows the third emoji

**Plan:** §3b — Loop cycle button, `🔁/🔂/🔄`
**Shipped:** [`playerButtons.ts:4`](../../src/lib/playerButtons.ts) — `loopEmoji()` returns
`🔂` for track and `🔁` for **both** queue and none. `🔄` is never rendered.

`none` and `queue` are distinguishable only by `ButtonStyle` (Secondary vs
Primary), which is a much weaker signal than a distinct glyph.

**Fix:** return `🔄` for one of the two states, matching the plan's three-glyph
cycle.

### D19 — "Previous" only restarts; it can't go back a track

**Plan:** §3b — "Previous/Restart | `player_previous` | ⏮️"
**Shipped:** [`playerControls.ts:61`](../../src/listeners/playerControls.ts) — `player.seek(0)` only.

The plan's slashed label arguably permits restart-only, so this is logged as a
capability gap rather than a defect. Kazagumo exposes `player.queue.previous`,
so real previous-track support is available if wanted.

---

## Phase 3 — verified correct (no debt)

- **§3a embed** — [`buildNowPlayingEmbed`](../../src/lib/music.ts) has the progress
  bar and all six required fields (Duration via the Progress field, Volume, Loop,
  Filters, Requester, Queue length). Footer wording matches the plan verbatim:
  `Up next: {title}` / `Last track in queue`.
- **§3b button rows** — two rows; all ten customIds and emoji match the plan's
  tables exactly (`player_previous`, `player_pause`, `player_skip`,
  `player_stop`, `player_loop` / `player_shuffle`, `player_vol_down`,
  `player_vol_up`, `player_lyrics`, `player_filters`). Pause emoji correctly
  flips ▶️/⏸️ off `player.paused`.
- **§3b filters menu** — the 🎛️ button opens an ephemeral `StringSelectMenu` as
  specified, with active filters pre-marked.
- **§3c** — voice-channel membership is validated (lines 18–24), DJ role is
  checked via the shared `checkDJPermission` utility from `src/lib/music.ts`
  exactly as the plan directed, handlers respond ephemeral, and
  `updateNowPlaying()` re-edits the embed after state changes.
- **§3d** — `addPlayHistory` is called from `playerStart` with the requester
  pulled from `player.data`'s `PlayerMeta`, and is wrapped in try/catch so a DB
  failure can't kill playback. Correct as written — but see **D10** for why it
  frequently doesn't run.

---

# Phase 1 — Database Schema & Migration

Schema and config module are otherwise complete and match the plan's column
tables exactly (verified in the first audit pass). One item:

### D20 — `active_sessions` is dead schema

**File:** [`src/lib/database.ts:131`](../../src/lib/database.ts)
**Severity:** low — unused table, no correctness impact

The table is created on every boot but the string `active_sessions` appears
nowhere else in `src/`. Nothing inserts, reads, or expires a row. Plan §1
justified it as "Track active WebUI sessions for security", and §5b then chose
Sapphire's encrypted auth cookie instead, which made the table redundant.

Note the interaction with **D23**: the WebSocket layer _does_ need real session
validation, and this table is the obvious place to put it. So either wire it up
as part of fixing D23, or drop the table and its `expires_at` cleanup story.

**Fix:** use it in the D23 fix, or delete the `CREATE TABLE`.

---

# Phase 4 — Core Music Utilities Module

[`src/lib/music.ts`](../../src/lib/music.ts) exists with all nine planned
utilities present in behavior. Two naming/signature drifts, both stemming from
the discord-player→Kazagumo swap (§0):

### D21 — `getQueueOrFail` shipped as `getPlayerOrFail`, and is never called

**Plan:** §4 — `getQueueOrFail(guild)` — "Get queue or throw user-friendly error"
**Shipped:** [`music.ts:57`](../../src/lib/music.ts) — `getPlayerOrFail(player)`
**Severity:** low — dead code

Beyond the rename, the signature inverted: the plan's version takes a `guild` and
does the lookup; the shipped version takes an already-resolved player and only
null-checks it, which is most of the value gone.

It has **zero call sites**. Every command instead inlines
`getPlayer(guildId)` + its own `if (!player) return <message>`, which is exactly
the duplication Phase 4 existed to remove — the same 2-line guard is repeated in
~15 commands with slightly different wording each time.

**Fix:** either delete it, or give it the planned `(guild)` signature and adopt
it across the music commands.

### D22 — `serializeQueue` shipped as `serializePlayer`

**Plan:** §4 — `serializeQueue(queue)` · **Shipped:** [`music.ts:152`](../../src/lib/music.ts)

Pure rename, correct for a Kazagumo player. Noted only because §5c's route table
refers to "serialized via `serializeQueue`" and that name no longer exists.

Also present but unplanned (harmless, keep): `repeatModeLabel`.

---

# Phase 5 — WebUI Dashboard

## 8. Security

### D23 — WebSocket auth is not actually checked

**File:** [`src/lib/websocket.ts:73`](../../src/lib/websocket.ts)
**Severity:** **critical** — authentication bypass + missing authorization
**Plan violated:** §5d — "Server decrypts the cookie, validates session,
associates the socket with a user + guild" and "Server validates membership and
starts pushing state"

Two independent failures compound:

**(a) The cookie is never validated.** The upgrade handler regex-matches the
cookie _name_ and accepts literally any value:

```ts
const sessionMatch = /lyra_session=([^;]+)/.exec(cookieHeader);
if (!sessionMatch) {
	/* 401 */
}
// sessionMatch[1] is never decrypted, verified, or looked up
```

`Cookie: lyra_session=x` is sufficient to get a socket. No Discord account
required.

**(b) `subscribe` never checks membership.** The handler
([line 97](../../src/lib/websocket.ts)) checks only that _the bot_ is in the
guild:

```ts
const guild = container.client.guilds.cache.get(guildId);
if (!guild) {
	/* error */
}
// no check that the requesting user is a member — or who they even are
```

Combined, anyone who can reach the API port can subscribe to **any guild the bot
is in** and receive the full serialized player on a 1-second tick: track titles,
URLs, thumbnails, and — via `serializeTrack` — the **Discord user ID and username
of whoever queued each track**.

~~The REST side got this right ([`_helpers.ts:21`](../../src/routes/api/guilds/_helpers.ts)
checks `auth.data.guilds`); only the WebSocket path is unguarded.~~
**Corrected by [D37](#d37--requestauthdata-does-not-exist--the-entire-dashboard-api-fails-closed):**
`_helpers.ts` _attempts_ a membership check but reads a property that never
exists, so it fails closed on everyone rather than gating correctly. The REST
side is not a working reference implementation to copy from — fix D37 first,
then mirror the corrected logic here.

**Mitigating factor:** exposure is bounded by who can reach `API_PORT` (4000).
If the port is not published beyond the host, this is not remotely reachable —
but it is still a bypass, and the plan's §5b `DASHBOARD_ORIGIN ?? '*'` default
suggests public exposure is intended.

**Fix:** resolve the cookie to a real session in the upgrade handler (this is
what **D20**'s `active_sessions` table was for), attach the resolved user to the
socket, and re-check that user's guild membership inside the `subscribe` branch
using the same logic as `resolveGuild`. The plan's `{ type: 'auth', token }`
handshake was never implemented; either implement it or document cookie-only as
the deliberate replacement.

### D24 — No API route checks the DJ role

**Files:** all of [`src/routes/api/guilds/[guild]/`](../../src/routes/api/guilds)
**Severity:** high — the WebUI bypasses the entire Phase 2f permission model
**Plan violated:** §5c auth middleware, step 5 — "For destructive actions, check
DJ role permission"

`checkDJPermission` is imported by exactly one file in the codebase
([`playerControls.ts`](../../src/listeners/playerControls.ts)) and by **no route
at all**. `resolveGuild` implements steps 1–4 (auth → bot present → user member)
and stops there.

**Masked today by [D37](#d37--requestauthdata-does-not-exist--the-entire-dashboard-api-fails-closed):**
step 4 currently rejects everyone, so nobody reaches these routes at all. Fixing
D37 unmasks this one immediately — treat them as a single change, not two.

So with a DJ role configured, any guild member can `POST` to `/stop`, `/skip`,
`/shuffle`, `/volume`, `/loop`, `/remove`, `/move`, `/seek`, and `/filters` —
every action the Discord commands gate behind `DJOnly`. The dashboard is a
complete end-run around the DJ system.

**Fix:** add an opt-in `requireDJ` helper next to `resolveGuild` and call it from
the nine destructive routes. Note it needs a `GuildMember`, not just the auth
payload, so it must `guild.members.fetch(userId)` — see **D27** for the related
cache-miss hazard.

### D25 — `config.patch` spreads an unvalidated body

**File:** [`config.patch.ts:26`](../../src/routes/api/guilds/[guild]/config.patch.ts)
**Severity:** medium — input validation gap at a trust boundary

```ts
setMusicConfig({ guild_id: guildId, ...body });
```

`body` is cast, not validated. `setMusicConfig` doesn't clamp either, so
`{"default_volume": 100000}` or `-5` is persisted, and every subsequently created
player is built with it. The slash command enforces 1–100
([`config.ts:52`](../../src/commands/General/config.ts)); the API does not.

`dj_role_id` is likewise unchecked — an arbitrary string can be stored as a role
ID. `checkDJPermission` degrades gracefully on an unresolvable role (returns
`true`), so the practical effect is silently disabling the DJ system rather than
breaking it — which is worse, because it looks configured.

**Credit where due:** the other POST routes validate properly — volume is bounds-
checked 1–100, loop mode and filter name are allowlisted, and seek/move/remove
are bounds-checked. This route is the sole exception.

**Fix:** validate each field before the spread.

### D26 — `config.patch` can 403 a legitimate admin

**File:** [`config.patch.ts:18`](../../src/routes/api/guilds/[guild]/config.patch.ts)
**Severity:** low — fail-closed, but produces confusing behavior

```ts
const member = guild.members.cache.get(userId);
if (!member?.permissions.has('ManageGuild')) return response.error(Forbidden);
```

A cache miss is indistinguishable from "not an admin". Members are only reliably
cached after recent activity, so an admin who hasn't spoken lately gets a 403
that resolves itself later — the hardest kind of bug to report.

Fails closed, so it's a correctness/UX issue rather than a security one.

**Fix:** `await guild.members.fetch(userId)` with a catch.

### D27 — `/play` doesn't verify the caller is in the target voice channel

**File:** [`play.post.ts`](../../src/routes/api/guilds/[guild]/play.post.ts)
**Severity:** low

The route validates that `channelId` is a voice channel in the guild, but not
that the requesting user is _in_ it. Any guild member can summon the bot into any
voice channel — including one they can't see or join. The Discord commands can't
do this: `InVoiceWithBot` requires the caller be in voice.

**Fix:** check the caller's `voice.channelId` matches, or that they can view the
channel.

## 9. Missing real-time events

### D28 — Half the planned WebSocket events are never broadcast

**Plan:** §5d lists eight server→client events.
**Shipped:** four.

| Event              | Emitted? | Where                                         |
| ------------------ | -------- | --------------------------------------------- |
| `queueUpdate`      | ✅       | `wsPlayerStart.ts`, `wsQueueEnd.ts`           |
| `trackStart`       | ✅       | `wsPlayerStart.ts:16`                         |
| `trackProgress`    | ✅       | `websocket.ts:28` (1s interval, as specified) |
| `disconnected`     | ✅       | `wsQueueEnd.ts:16`                            |
| `pauseStateChange` | ❌       | never                                         |
| `volumeChange`     | ❌       | never                                         |
| `filterChange`     | ❌       | never                                         |
| `loopChange`       | ❌       | never                                         |

`broadcastEvent(guildId, type, data)` is a generic helper that would make each of
these a one-liner, but no caller exists. Consequence: pause, volume, filter, and
loop changes made **from Discord** never reach an open dashboard — it silently
shows stale state until something triggers a `queueUpdate`.

**Fix:** call `broadcastEvent` from the four command paths and the corresponding
`playerControls` button handlers.

### D29 — The client ignores three of the four events it does receive

**File:** [`web/src/components/Dashboard.svelte:23`](../../web/src/components/Dashboard.svelte)

```ts
ws.onmessage = (e) => {
	const msg = JSON.parse(e.data);
	if (msg.type === 'queueUpdate') queue = msg.queue; // and nothing else
};
```

`trackStart`, `trackProgress`, and `disconnected` are parsed and dropped. The
server pushes `trackProgress` every second per active guild — that work is
entirely wasted today.

This is what makes plan §5f's headline UX behavior — "Progress bar: smooth
client-side interpolation between 1s server ticks, clickable to seek" —
unimplemented. See **D31**.

**Credit:** reconnection _is_ implemented correctly
([line 27](../../web/src/components/Dashboard.svelte)) and re-subscribes via
`onopen`, satisfying the plan's edge case "WebSocket disconnect → client
auto-reconnects and re-subscribes".

## 10. Frontend gaps

### D30 — Five of nine planned components don't exist

**Plan:** §5f · **Shipped:** [`web/src/components/`](../../web/src/components)

| Planned                               | Status                 |
| ------------------------------------- | ---------------------- |
| `NowPlaying.svelte`                   | ✅                     |
| `QueueList.svelte`                    | ✅ as `Queue.svelte`   |
| `Controls.svelte`                     | ✅                     |
| `HistoryList.svelte`                  | ✅ as `History.svelte` |
| `ProgressBar.svelte` (clickable seek) | ❌                     |
| `VolumeSlider.svelte`                 | ❌                     |
| `FilterPanel.svelte`                  | ❌                     |
| `LyricsPanel.svelte`                  | ❌                     |
| `SearchBar.svelte`                    | ❌                     |

The backend for every missing one already exists and is tested-by-inspection:
`/seek`, `/volume`, `/filters` (GET+POST), `/lyrics`, and `/play` are all live
routes. **The API surface is ahead of the UI** — this is the single largest
remaining chunk of Phase 5, and it's additive work with no redesign needed.

Also: plan's `web/src/routes/` split doesn't exist — `Login`, `GuildSelector`,
and `Dashboard` sit flat in `components/`. Cosmetic.

### D31 — No drag-to-reorder; the `/move` API is unreachable from the UI

**Plan:** §5f — "QueueList.svelte — Drag-to-reorder queue (via move API)", and
§5f key UX — "Queue drag-and-drop: reorder tracks, calls `/move` API"

Zero occurrences of `drag` anywhere under `web/src/`.
[`move.post.ts`](../../src/routes/api/guilds/[guild]/move.post.ts) is fully
implemented and correct, with no caller.

### D32 — The frontend has no TypeScript and no shared lib layer

**Plan:** §5f specified `vite.config.ts`, `tsconfig.json`, and a
`web/src/lib/` holding `api.ts`, `ws.ts`, `stores.ts`, `types.ts`.
**Shipped:** `vite.config.js`, `main.js`, no `tsconfig.json`, no `lib/` directory.

Consequences visible in the code today: `fetch` calls are scattered across four
components with no shared client (`App.svelte`, `Controls.svelte`,
`Dashboard.svelte`, `History.svelte`), WebSocket handling is inline in
`Dashboard.svelte` rather than a reusable `ws.ts`, state is passed by prop-
drilling instead of Svelte stores, and there are no shared types — so the
server's `serializePlayer` shape and the client's assumptions about it can drift
with nothing to catch it.

Verified correct in the build config: `outDir: '../dist/web'` matches the plan,
and the dev proxy covers `/api`, `/oauth`, and `/ws` (with `ws: true`).

### D33 — Build script names differ from the plan

**Plan:** §5g — `build:web`, `dev:web` · **Shipped:** `web:build`, `web:dev`

Functionally equivalent and `build` correctly chains `tsup && yarn web:build`.
Flagged only so anyone following the plan verbatim doesn't hit a missing script.

`.gitignore` covers `dist/web/` via the broader `dist/` (line 17) — plan
satisfied. The `Dockerfile` builds the SPA (`yarn build` → `web:build`, which
runs its own `yarn install`) and ships it via `COPY --from=builder /app/dist`.
Correct.

---

# Phase 6 — Fix Existing Issues

### D34 — 6d is half done: `recorder.ts` still has its own resampling code

**Plan:** §6d — "Extract shared PCM→Float32 resampling logic from `recorder.ts`
**and** `transcription.ts` into `src/lib/audio-utils.ts`"
**Severity:** low — the duplication the task existed to remove is still there

[`audio-utils.ts`](../../src/lib/audio-utils.ts) exists and
[`transcription.ts:4`](../../src/lib/transcription.ts) imports
`convertPcmToFloat32MonoResample` from it. But
[`recorder.ts`](../../src/lib/recorder.ts) never imports it — it still carries
its own `readAudioFile` (line 297) and `resampleAudio` (line 333).

Only one of the two callers was migrated, so the module exists _and_ the
duplicate remains.

**Fix:** migrate `recorder.ts` to `audio-utils.ts`, or document why its
48k→16k-with-VAD path is genuinely different.

The other half of §6d **is** done: `transcription.ts` has a single config-refresh
block (line 244), not the duplicated pair the plan called out at ~224–234.

### D35 — 6b has no user-facing warning

**Plan:** §6b — "Add a warning message if both systems are active simultaneously"
**Shipped:** [`transcription.ts:346`](../../src/lib/transcription.ts)

The core fix is correct and verified: `stopTranscriptionSession` checks
`kazagumo.getPlayer(guildId)` and leaves the voice connection intact when music
is playing. But the "both active" signal is `container.logger.info` — a log line,
not a message to the user who ran the command.

**Fix:** surface it in the `/transcribe` and `/record` command replies.

### Phase 6a — naming note

Plan §6a specified an interface named `QueueMetadata`; shipped as `PlayerMeta` in
[`queueMetadata.ts`](../../src/lib/queueMetadata.ts). Field-for-field it matches,
including the `interaction: … | null` allowance the plan called for so WebUI-
queued tracks can omit it. No action needed.

Phase 6c (dual command support on `play`/`queue`/`skip`/`skipto`) is complete —
verified in the Phase 2 pass.

---

# Phase 7 — Config Command Updates

All five planned surfaces exist and are admin-gated (`ManageGuild` or
`Administrator`): `/config music dj-role` (set + clear), `default-volume`
(1–100 enforced), `announce`, and `/config view` showing music config alongside
transcribe config. All three message equivalents work. One functional gap:

### D36 — `announce_tracks` is a write-only setting

**Severity:** medium — a shipped, documented toggle silently does nothing

`announce_tracks` is defined, persisted, defaulted, displayed by `/config view`,
settable from slash, message, and the API — and **read by nothing**.

[`playerStart.ts`](../../src/listeners/playerStart.ts) unconditionally builds and
sends the now-playing message; it never calls `getMusicConfig`. Every occurrence
of the identifier is in the config plumbing itself (`config.ts`, `database.ts`,
`config.patch.ts`) — none in the listener that would have to honor it.

So `/config music announce off` reports success, persists `0`, shows `off` in
`/config view`, and announcements keep arriving.

**Fix:** early-return from `playerStart` when `getMusicConfig(guildId)
.announce_tracks` is false. Note this needs a decision: skipping the message also
skips creating the button controls, so "announce off" would mean "no player UI"
unless the buttons are posted some other way.

---

# Second pass (D37–D46) — auth contract, OAuth flow, dependencies

Areas the first pass didn't reach: the `@sapphire/plugin-api` auth contract, the
hand-rolled OAuth routes, `src/middlewares/StaticFiles.ts` (§5e — never audited),
the dependency manifest, and the pagination requirements in §2c/§2d/§2e.

## 11. The dashboard does not work

### D37 — `request.auth.data` does not exist — the entire dashboard API fails closed

**Files:** [`_helpers.ts:21`](../../src/routes/api/guilds/_helpers.ts),
[`guilds.get.ts:15`](../../src/routes/api/guilds.get.ts),
[`config.patch.ts:17`](../../src/routes/api/guilds/[guild]/config.patch.ts),
[`play.post.ts:22`](../../src/routes/api/guilds/[guild]/play.post.ts)
**Severity:** **critical** — Phase 5 is shipped but non-functional end to end
**Plan violated:** §5c auth middleware, steps 2 and 4

Four routes read `request.auth.data`. That property does not exist. The plugin's
auth middleware sets `request.auth` to the _decrypted cookie payload_ and nothing
more:

```js
// node_modules/@sapphire/plugin-api/dist/cjs/middlewares/auth.cjs
request.auth = this.container.server.auth.decrypt(authorization);
```

and the shipped type is `auth?: AuthData | null` where `AuthData` is
`{ id, expires, refresh, token }` — no `data`, no `user`, no `guilds`. The
Discord profile/guild payload comes from `auth.fetchData(token)`, which the
codebase calls only in `oauth/callback` and `oauth/@me` and never stores.

Every call site launders the mistake through an `as any` cast, which is why this
compiles:

```ts
const userGuilds: any[] = (auth.data as any)?.guilds ?? []; // always []
const inGuild = userGuilds.some((g: any) => g.id === guildId); // always false
if (!inGuild) {
	response.error(HttpCodes.Forbidden);
	return null;
}
```

Traced consequences:

| Site                 | Reads              | Actual value              | Effect                                                                                |
| -------------------- | ------------------ | ------------------------- | ------------------------------------------------------------------------------------- |
| `_helpers.ts:21`     | `auth.data.guilds` | `undefined` → `[]`        | **Every** guild-scoped route returns 403 to every authenticated user                  |
| `guilds.get.ts:15`   | `auth.data.guilds` | `undefined` → `[]`        | `/api/guilds` always returns `[]` — the guild picker is permanently empty             |
| `config.patch.ts:17` | `auth.data.id`     | `undefined`               | `guild.members.cache.get(undefined)` → 403 (unreachable behind the above anyway)      |
| `play.post.ts:22`    | `auth.data.id`     | `undefined` → `'unknown'` | Requester recorded as the literal string `'unknown'` in `PlayerMeta` and play history |

So the shipped user journey is: log in → land on an empty guild list → done.
Nothing downstream of `/api/guilds` is reachable. This also means **every Phase 5
route finding in this document is currently untestable in situ** — D24, D25,
D26, D27 all sit behind a gate that rejects everyone.

**Fix:** the user ID is `request.auth.id` — use that directly for all four
`auth.data.id` reads. Guild membership needs a real source; two options:

- **(a)** call `container.server.auth.fetchData(request.auth.token)` inside
  `resolveGuild` and read `.guilds` (accurate, but 3 Discord API calls per
  request — see **D40**); or
- **(b)** check `guild.members.fetch(userId)` and treat a fetch failure as
  "not a member" (one call, scoped to the guild being asked about, and it yields
  the `GuildMember` that **D24** and **D26** both need anyway).

(b) is the better shape: it fixes D24's missing `GuildMember`, D26's cache-miss
403, and this entry in one pass. `guilds.get.ts` still needs the user's full
guild list, so it keeps option (a).

## 12. OAuth flow

### D38 — Logout does not log out

**Files:** [`web/src/App.svelte:36`](../../web/src/App.svelte)
**Severity:** high — user-visible, and leaves a live credential behind
**Plan violated:** §5b — "Sapphire auto-registers `/oauth/callback` and
`/oauth/logout` routes"

```js
function handleLogout() {
	document.cookie = 'lyra_session=; Max-Age=0; path=/';
	user = null;
	guilds = [];
	selectedGuild = null;
}
```

The cookie is set by Sapphire's `CookieStore`, whose `prepare()` appends
`HttpOnly` unless explicitly disabled (`if (httpOnly ?? true)`) — and
`LyraClient.ts:83` passes only `cookie: 'lyra_session'`, so the default applies.
**JavaScript cannot delete an `HttpOnly` cookie.** The assignment is silently
discarded by the browser. (It also omits the `Domain` attribute the cookie was
written with, so it would miss even if the cookie were readable.)

Result: clicking Logout resets local component state only. A page refresh calls
`/oauth/@me`, the cookie is still attached, and the user is logged straight back
in. The Discord access token is never revoked either.

The plugin already ships the correct endpoint — `POST /oauth/logout`
(`node_modules/@sapphire/plugin-api/dist/cjs/routes/oauth/logout.post.cjs`),
which revokes the token against Discord and calls `response.cookies.remove(...)`
server-side. It is enabled whenever `server.auth` is non-null, so it is live
right now. Nothing in `web/src/` calls it — `grep -rn logout web/src/` returns
only this function.

**Fix:** `await fetch('/oauth/logout', { method: 'POST' })` before clearing local
state, and drop the `document.cookie` line.

### D39 — The OAuth flow has no `state` parameter

**Files:** [`oauth/login.get.ts:16`](../../src/routes/oauth/login.get.ts),
[`oauth/callback.get.ts:16`](../../src/routes/oauth/callback.get.ts)
**Severity:** medium — login CSRF

`login.get.ts` builds the authorize URL from `client_id`, `redirect_uri`,
`response_type`, and `scope` — no `state`. `callback.get.ts` correspondingly
reads only `code` and never validates a state value.

Without it, an attacker can complete the first leg of the flow with their own
Discord account and hand the victim a crafted `/oauth/callback?code=…` link; the
victim's browser silently receives a `lyra_session` cookie bound to the
_attacker's_ Discord identity. Subsequent dashboard actions the victim takes are
then attributed to, and scoped by, the attacker's account.

Note both routes are hand-written here — the plan assumed Sapphire's built-in
`oauth/callback` (which is `POST`-only, hence the custom `GET` redirect flow).
That's a reasonable adaptation, but it means the plugin's conventions don't cover
these routes and `state` has to be added explicitly.

**Fix:** generate a random `state`, store it in a short-lived `HttpOnly` cookie
alongside the redirect, and compare on callback before exchanging the code.

### D40 — `/oauth/@me` re-fetches the full Discord login payload on every call

**File:** [`oauth/@me.get.ts:24`](../../src/routes/oauth/@me.get.ts)
**Severity:** low — rate-limit and latency cost

The route decrypts the cookie itself and then calls `auth.fetchData(session.token)`,
which fans out to **three** Discord endpoints (`/users/@me`, `/users/@me/guilds`,
`/users/@me/connections`) — and then returns only `userData.user`. Two of the
three calls are discarded.

`request.auth` is already populated by the auth middleware at this point, so the
manual decrypt is redundant; the `id` is available without any network call. If
`fetchData` is needed at all, this is the natural place to cache its result for
the session — which is also what **D37** option (a) would otherwise re-issue on
every guild request.

**Fix:** use `request.auth` for the identity, and fetch only `/users/@me` (or
cache the `LoginData` per session).

## 13. Plan/implementation drift not previously logged

### D41 — Two API routes exist that the plan's route table doesn't list

**Plan:** §5c enumerates 17 routes.
**Shipped:** those 17 plus two more.

| Route                                                                          | Consumer                                                                         | Verdict                                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`channels.get.ts`](../../src/routes/api/guilds/[guild]/channels.get.ts)       | [`Controls.svelte:14`](../../web/src/components/Controls.svelte) (`?type=voice`) | Justified — `/play` needs a `channelId` and the plan gave the UI no way to obtain one. Fold it into the plan. |
| [`leaderboard.get.ts`](../../src/routes/api/guilds/[guild]/leaderboard.get.ts) | none                                                                             | Unrelated to the music overhaul; no frontend caller. Either build the UI or drop it from this surface.        |

Both correctly go through `resolveGuild`, so they inherit D37 and D24.

### D42 — The entire discord-player stack is still an installed dependency with zero imports

**File:** [`package.json`](../../package.json)
**Severity:** medium — install size, build time, and a live footgun
**Related:** §0 (wrong player library in the plan)

§0 records that the plan was written against discord-player and the
implementation went to Kazagumo. What it doesn't record is that **the discard was
never finished** — seven packages remain direct `dependencies`:

`discord-player`, `@discord-player/equalizer`, `@discord-player/extractor`,
`@discord-player/utils`, `discord-player-youtubei`, `play-dl`, `mediaplex`

`grep -rn "discord-player\|play-dl" src/` returns nothing. Several of these carry
native builds, so they cost real time in the Docker image for no runtime benefit.

The footgun: they're importable. Any future work — or an agent following the plan
literally, which still documents `queue.node.setVolume()` — will find
`discord-player` resolvable and write against it, producing code that compiles
and silently controls a player the bot never uses.

**Fix:** remove all seven from `dependencies` and rebuild the lockfile. Do this
together with the §0 plan correction, not separately. Verify at runtime before
merging — `mediaplex` and `sodium-native` are native encryption/transcode
backends that `@discordjs/voice` can pick up by presence rather than by import,
and the recorder/transcription paths depend on that resolution order. The
unambiguous removals are `discord-player`, the three `@discord-player/*`
packages, `discord-player-youtubei`, and `play-dl`.

### D43 — Lyrics aren't paginated, and long lyrics are silently truncated

**Plan:** §2d — "Display in paginated embed (lyrics can be long)"
**File:** [`lyrics.ts:42`](../../src/commands/music/lyrics.ts)
**Severity:** medium — silent data loss

`buildLyricsEmbed` splits at 4096 chars, then `chunks.slice(0, 5)`. Two problems:

1. **No pagination.** Both `chatInputRun` and `messageRun` send chunk 0, then
   loop `followUp`/`channel.send` for the rest — up to **five separate messages**
   spamming the channel, which is the outcome §2d specified pagination to avoid.
2. **Silent truncation.** Anything past 20,480 characters is dropped with no
   ellipsis, no footer, no warning. The user sees a lyrics embed that simply
   stops. (Reachable: Genius pages for long tracks, and any result where the
   scrape picks up annotations.)

`@sapphire/discord.js-utilities` is already a direct dependency and exports
`PaginatedMessage`, so the planned behavior is available without a new package.

**Fix:** build one `PaginatedMessage` over all chunks, with a page counter in the
footer. Truncation then stops being a concern.

### D44 — A `/history` page can exceed Discord's embed description limit

**File:** [`history.ts:30`](../../src/commands/music/history.ts)
**Severity:** low — latent, input-dependent failure

`PAGE_SIZE = 20`, and each row renders as two lines with an unbounded track
title, an unbounded URL, a user mention, and a date, joined by `\n\n`. Nothing
truncates. At ~200 chars/entry the description crosses Discord's 4096-char cap
and the API rejects the whole reply — so a guild whose history happens to contain
long titles gets a hard failure on `/history` rather than a degraded page.

Typical rows land around 100–150 chars, which is why this hasn't fired.

**Fix:** clamp each title (e.g. `.slice(0, 60)`) or drop `PAGE_SIZE` to 10. The
plan's "last 20 tracks" wording argues for clamping the title.

### D45 — `/search` and `/play` only ever search YouTube

**Plan:** §2a — "`/search <query>` — Search YouTube/SoundCloud"
**Files:** [`search.ts:40`](../../src/commands/music/search.ts),
[`play.ts:26`](../../src/commands/music/play.ts)
**Severity:** low — capability gap

Every call is `kazagumo.search(query, { requester })` with no `engine` option, so
all of them fall through to `defaultSearchEngine: 'youtube'`
([`LyraClient.ts:94`](../../src/LyraClient.ts)). There is no source selector on
either command.

Kazagumo's search accepts a per-call engine, so this is a small additive change —
a `source` choice option on `/search`, defaulting to youtube.

### D46 — Static file serving never sets production cache headers by default

**File:** [`StaticFiles.ts:10`](../../src/middlewares/StaticFiles.ts)
**Plan:** §5e — "Sets proper MIME types and caching headers"
**Severity:** low

```ts
const serveStatic = hasWebDist ? sirv(webDistPath, { single: true, dev: process.env.NODE_ENV !== 'production' }) : null;
```

`sirv`'s `dev: true` disables `Cache-Control` and re-stats every file per
request. `NODE_ENV` is unset in `src/.env.example` for local runs and set to
`production` only in `.env.prod.example`, so any deployment that forgets it
serves the SPA uncached forever. MIME types are handled by sirv correctly.

Also worth knowing: `hasWebDist` is evaluated **once at module load**. If the bot
starts before `dist/web/` exists, static serving stays disabled until a full
restart — no amount of rebuilding the SPA will bring it up.

**Fix:** invert the default (`dev: process.env.NODE_ENV === 'development'`), and
consider re-checking `existsSync` lazily on first request.

---

## Phase 5e — verified correct (no debt)

- The middleware sits at `position: 5` as §5e specified, uses `sirv` as the plan
  decided, and passes `single: true` for SPA fallback routing.
- It correctly excludes `/api`, `/oauth`, **and** `/ws` (the plan only named the
  first two; `/ws` is required for the WebSocket upgrade path to reach
  [`websocket.ts:65`](../../src/lib/websocket.ts)).

## Phase 5b — verified correct (no debt)

- [`LyraClient.ts:75-88`](../../src/LyraClient.ts) matches the plan's `api` block
  field for field, with the `Identify`/`Guilds` scopes, `API_PORT` defaulting to
  4000, and `DASHBOARD_ORIGIN ?? '*'`. Guarding `auth` behind the presence of
  `DISCORD_CLIENT_ID`/`SECRET` is an unplanned improvement — the bot boots fine
  with the dashboard unconfigured.
- All five planned env vars are documented in **both**
  [`src/.env.example`](../../src/.env.example) and
  [`src/.env.prod.example`](../../src/.env.prod.example), with correct defaults.

## Phase 1 & dependencies — verified correct (no debt)

- `idx_play_history_guild_played ON play_history (guild_id, played_at DESC)`
  exists ([`database.ts:129`](../../src/lib/database.ts)) — §1's index requirement
  met verbatim.
- [`musicHistory.ts`](../../src/lib/musicHistory.ts) is at the planned path with
  `addPlayHistory` / `getPlayHistory(guildId, limit, offset)` as specified, plus
  `getTopTracks` / `getTopUsers` backing §2e's stats.
- Every package §5's dependency table called for is a direct dependency: `ws`,
  `genius-lyrics`, `sirv`, and `svelte` / `vite` / `@sveltejs/vite-plugin-svelte`
  in the `web` workspace. (See **D42** for what should _not_ be there.)
- §2c's "Autocomplete for filter/preset names" is implemented —
  [`filter.ts:41`](../../src/commands/music/filter.ts) handles both options.
