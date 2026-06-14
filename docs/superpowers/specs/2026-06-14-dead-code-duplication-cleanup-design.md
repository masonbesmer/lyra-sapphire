# Design: Dead Code & Duplication Cleanup

**Date:** 2026-06-14  
**Status:** Approved

## Context

The lyra-sapphire Discord bot has accumulated significant command-handler duplication. Every music command with both slash and prefix variants (`play`, `search`, `record`) repeats the same 10–35 line core logic inside `chatInputRun` and `messageRun`. The pattern is: resolve voice channel → get/create Kazagumo player → set player metadata → queue tracks → start playback. This block is copy-pasted rather than shared, making changes error-prone and the commands harder to read.

Secondary goal: sweep for and remove commented-out dead code across `src/` (excluding `starboardReactions.ts`, which will be handled separately).

## What We're Building

### 1. New helper module: `src/lib/musicCommandHelpers.ts`

Four functions extracted from duplicated command logic:

```
getOrCreatePlayer(kazagumo, { guildId, voiceId, textId, volume }): Promise<KazagumoPlayer>
```

Retrieves existing player or creates a new one. Replaces the `if (!player) { await kazagumo.createPlayer(...) }` block repeated in `play.ts` and `search.ts`.

```
initPlayerMeta(player, meta: PlayerMeta): void
```

Sets `PLAYER_META_KEY` and initializes `activeFilters` if missing. Replaces the 3-line `player.data.set(...)` block repeated in `play.ts`, `search.ts`, and potentially others.

```
queueAndLabel(player, result: KazagumoSearchResult): Promise<string>
```

Adds tracks to the queue (full playlist or single track), starts playback if idle, returns a human-readable label string (`"queued **Title** ✅"` or `"queued playlist **X** (N tracks) ✅"`). Replaces the identical 10-line block in both `play.ts` run methods.

```
getOrCreateVoiceConnection(guild, channel): Promise<VoiceConnection>
```

Handles `getVoiceConnection` → `joinVoiceChannel` → `entersState(Ready, 20_000)`. Replaces the 10-line voice-join block repeated in both `record.ts` run methods.

### 2. Refactored commands

**`src/commands/music/play.ts`**  
Both `chatInputRun` and `messageRun` collapse to: normalize input → call `getOrCreatePlayer` → `initPlayerMeta` → `queueAndLabel` → reply. Try-block shrinks from ~35 lines to ~10.

**`src/commands/music/search.ts`**  
The `collect` handler (repeated in chatInput dropdown and message number-reply) is extracted to an internal `addTrackAndPlay(voiceChannel, track)` function that calls `getOrCreatePlayer` + `initPlayerMeta` + `queue.add` + `player.play()`. The two UIs (dropdown vs number reply) stay separate — only the queue-add core is shared.

**`src/commands/music/record.ts`**  
Both run methods call `getOrCreateVoiceConnection` instead of repeating the `getVoiceConnection`/`joinVoiceChannel`/`entersState` block. The recording and file-attachment logic stays in place.

### 3. Dead code sweep

- **`src/lib/music.ts`**: Check if `serializeQueue` (the `@deprecated` alias for `serializePlayer`) is imported anywhere in `src/`. Delete the alias if unused.
- **All `src/` files**: Grep for commented-out code blocks (multi-line `//` or `/* */` disabled code, not inline explanatory comments). Remove confirmed dead blocks.
- **Unused imports**: Run `tsc --noEmit` to surface unused-import warnings under strict mode; remove any that TSC flags.

### Out of scope

- `starboardReactions.ts` commented-out block (intentionally deferred)
- `filter.ts`, `history.ts`, `keyword.ts`, `permissions.ts`, `starboard.ts` dual-run duplication (UX differences are legitimate, no clear shared core)
- `music-plan.md` deletion (requires separate owner decision)
- Test infrastructure

## Existing utilities to reuse

- `PLAYER_META_KEY` and `PlayerMeta` type from `src/lib/queueMetadata.ts`
- `getActiveFilters` from `src/lib/lavalinkFilters.ts`
- `getMusicConfig` from `src/lib/config.ts`
- `formatDuration` from `src/lib/music.ts` (used in `queueAndLabel` label string)

## Verification

1. Run `yarn tsc --noEmit` — zero new errors
2. Start bot locally, exercise `/play`, `%play`, `/search`, `%search`, `/record`, `%record` manually
3. Confirm player creates, tracks queue, playback starts, attachment sends
4. Confirm the `@deprecated` alias removal (if applied) doesn't break runtime by checking imports first
