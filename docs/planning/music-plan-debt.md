# Music Overhaul — Debt & Plan Discrepancies

Companion to [`music-plan.md`](./music-plan.md). Records where the shipped
implementation diverges from the plan, and why.

**Scope of this audit:** all seven phases, source-level review as of 2026-08-10
(`ccbe33c`). Dependencies were not installed in the audit worktree, so no `tsc`
run and no runtime testing backs these findings.

**Index:** D1–D9 Phase 2 · D10–D19 Phase 3 · D20 Phase 1 · D21–D22 Phase 4 ·
D23–D32 Phase 5 · D33–D35 Phase 6 · D36 Phase 7.

**Triage — fix these first:**

| ID | What | Why it's top of the list |
|---|---|---|
| **[D23](#d23--websocket-auth-is-not-actually-checked)** | WS accepts any `lyra_session` cookie value; `subscribe` never checks membership | Full auth bypass — leaks any guild's music state incl. requester user IDs |
| **[D24](#d24--no-api-route-checks-the-dj-role)** | No API route checks the DJ role | WebUI bypasses the entire Phase 2f permission model |
| **[D10](#d10--play-history-is-only-recorded-sometimes)** | Play history usually isn't recorded | Silently guts `/history`, stats, and the history API |
| **[D36](#d36--announce_tracks-is-a-write-only-setting)** | `announce_tracks` is never read | A shipped config toggle does nothing |

---

## 0. Root cause of most divergence: wrong player library in the plan

The plan was written against **discord-player v7** (`queue.node.setVolume()`,
`queue.filters.ffmpeg.toggle()`, `queue.setRepeatMode()`). The bot actually runs
**Kazagumo 3.4.3 + Shoukaku 4.3.0 against a Lavalink node**.

Every API reference in the plan is therefore notional. The implementation
adapted correctly; the entries below are the places where that adaptation
changed *user-visible behavior*, not just the call signature.

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

`deferReply()` followed by `followUp()` puts the select menu on a *second*
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

Deferring and then calling `followUp` sends an *additional* message and leaves
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

### D10 — Play history is only recorded *sometimes*

**File:** [`src/listeners/playerStart.ts:40`](../../src/listeners/playerStart.ts)
**Severity:** high — silently breaks a shipped feature
**Breaks:** Phase 3d, Phase 2e (`/history`, `/history stats`), Phase 5c
(`/api/guilds/[guild]/history`)

`addPlayHistory()` sits at the *end* of `run()`, but the edit-in-place branch
returns early at line 40 and never reaches it:

```ts
if (latest && latest.id === previousMessage.id) {
    await previousMessage.edit({ content, embeds: [embed], components: rows });
    await storePlayerMessage(channel, previousMessage);
    return;                      // ← skips addPlayHistory() entirely
}
```

Traced behavior:

| Situation | Path | History recorded? |
|---|---|---|
| First track (no cached message) | send | ✅ |
| Next track, player message still the newest in channel | **edit → early return** | ❌ |
| Next track, someone chatted since | delete + send | ✅ |

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
`player_filter_select` handler runs *before* the switch and its customId is not
in that list — so the toggle itself is never re-authorized.

Exploitable window: a user opens the menu while alone in voice (DJ check bypasses
when alone), others then join, and the still-open ephemeral menu keeps working
without the DJ role. Permission is checked when the menu is *opened*, never when
the action is *executed*.

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
call renders whatever the player reports *right now*, which may still be the
outgoing track — a brief wrong-state flash before `playerStart` corrects it.

**Fix:** drop the `updateNowPlaying()` call from the skip case and let
`playerStart` own the repaint.

### D16 — Pause and Restart are ungated while Stop and Skip are not

**File:** [`src/listeners/playerControls.ts:30`](../../src/listeners/playerControls.ts)
**Severity:** low — policy inconsistency, flagging for a decision

`destructiveIds` covers skip, stop, shuffle, loop, vol_down, vol_up, filters. It
omits `player_pause` and `player_previous` — so any user in the voice channel can
pause playback or restart the current track for everyone, with no DJ role.

Omitting pause is at least *consistent* with Phase 2 (the `/pause` command also
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

Note the interaction with **D23**: the WebSocket layer *does* need real session
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
cookie *name* and accepts literally any value:

```ts
const sessionMatch = /lyra_session=([^;]+)/.exec(cookieHeader);
if (!sessionMatch) { /* 401 */ }
// sessionMatch[1] is never decrypted, verified, or looked up
```

`Cookie: lyra_session=x` is sufficient to get a socket. No Discord account
required.

**(b) `subscribe` never checks membership.** The handler
([line 97](../../src/lib/websocket.ts)) checks only that *the bot* is in the
guild:

```ts
const guild = container.client.guilds.cache.get(guildId);
if (!guild) { /* error */ }
// no check that the requesting user is a member — or who they even are
```

Combined, anyone who can reach the API port can subscribe to **any guild the bot
is in** and receive the full serialized player on a 1-second tick: track titles,
URLs, thumbnails, and — via `serializeTrack` — the **Discord user ID and username
of whoever queued each track**.

The REST side got this right ([`_helpers.ts:21`](../../src/routes/api/guilds/_helpers.ts)
checks `auth.data.guilds`); only the WebSocket path is unguarded.

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
that the requesting user is *in* it. Any guild member can summon the bot into any
voice channel — including one they can't see or join. The Discord commands can't
do this: `InVoiceWithBot` requires the caller be in voice.

**Fix:** check the caller's `voice.channelId` matches, or that they can view the
channel.

## 9. Missing real-time events

### D28 — Half the planned WebSocket events are never broadcast

**Plan:** §5d lists eight server→client events.
**Shipped:** four.

| Event | Emitted? | Where |
|---|---|---|
| `queueUpdate` | ✅ | `wsPlayerStart.ts`, `wsQueueEnd.ts` |
| `trackStart` | ✅ | `wsPlayerStart.ts:16` |
| `trackProgress` | ✅ | `websocket.ts:28` (1s interval, as specified) |
| `disconnected` | ✅ | `wsQueueEnd.ts:16` |
| `pauseStateChange` | ❌ | never |
| `volumeChange` | ❌ | never |
| `filterChange` | ❌ | never |
| `loopChange` | ❌ | never |

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
  if (msg.type === 'queueUpdate') queue = msg.queue;   // and nothing else
};
```

`trackStart`, `trackProgress`, and `disconnected` are parsed and dropped. The
server pushes `trackProgress` every second per active guild — that work is
entirely wasted today.

This is what makes plan §5f's headline UX behavior — "Progress bar: smooth
client-side interpolation between 1s server ticks, clickable to seek" —
unimplemented. See **D31**.

**Credit:** reconnection *is* implemented correctly
([line 27](../../web/src/components/Dashboard.svelte)) and re-subscribes via
`onopen`, satisfying the plan's edge case "WebSocket disconnect → client
auto-reconnects and re-subscribes".

## 10. Frontend gaps

### D30 — Five of nine planned components don't exist

**Plan:** §5f · **Shipped:** [`web/src/components/`](../../web/src/components)

| Planned | Status |
|---|---|
| `NowPlaying.svelte` | ✅ |
| `QueueList.svelte` | ✅ as `Queue.svelte` |
| `Controls.svelte` | ✅ |
| `HistoryList.svelte` | ✅ as `History.svelte` |
| `ProgressBar.svelte` (clickable seek) | ❌ |
| `VolumeSlider.svelte` | ❌ |
| `FilterPanel.svelte` | ❌ |
| `LyricsPanel.svelte` | ❌ |
| `SearchBar.svelte` | ❌ |

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

Only one of the two callers was migrated, so the module exists *and* the
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
