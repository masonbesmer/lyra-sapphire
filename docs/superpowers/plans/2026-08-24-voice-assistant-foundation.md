# Voice Assistant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the non-functional `/transcribe` feature, then add an always-on, wake-word-gated voice assistant that lets users in a voice channel control existing music commands by speaking ("Hey Lyra, skip"), running fully off the main event loop and using a fully self-hosted STT stack.

**Architecture:** Per-user Opus streams are decoded on the main thread (reusing the _proven_ primitives from `recorder.ts`), downmixed/resampled to 16 kHz mono, and pushed to a **worker thread** running openWakeWord + Silero VAD. On a wake hit, the worker endpoints a discrete utterance and hands the buffer back; the session ships it to a **GPU STT sidecar** over HTTP as a single batch request. The transcript goes through a grammar-first intent parser and dispatches into a new shared `musicActions` service layer — the same layer the REST routes use — so voice, web, and slash commands share one code path.

**Tech Stack:** TypeScript, Sapphire Framework v5, better-sqlite3, discord.js v14, `@discordjs/voice`, `prism-media`, `onnxruntime-node`, `worker_threads`, faster-whisper sidecar (Docker, CUDA)

---

> **No test framework exists in this project.** TDD steps are replaced with type checking (`yarn typecheck`, or `yarn check` for the full gate) and manual smoke-test instructions. **Not `yarn build:bot`** — it does not typecheck. See **Verification**.

---

## Current State

> **Status as of 2026-08-25.** Phases 0 and 1 are shipped and deployed to `main`. Production disproved several of this plan's original assumptions; the sections below record what is actually true now. See **Risks & Open Questions** for which risks fired and which were false alarms.

### What works: `/record`

`src/lib/recorder.ts` is the reference for the capture side, and production confirms it: a 10 s `/record` with four users in the channel returned `4/4 successful` and merged cleanly.

- `receiver.subscribe(userId, { end: EndBehaviorType.Manual })` per user
- `prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })` -> 48 kHz stereo s16le
- `speaking.on('start')` to catch users who join mid-session
- silence-gap insertion to keep tracks time-aligned
- per-user ffmpeg -> WAV, then an `amix` merge
- a **batch** shape: capture a discrete, bounded chunk, then process it as one unit

### What `/record` no longer does: transcribe

In-process Whisper via `@xenova/transformers` aborted the process inside ONNX Runtime on every invocation:

```
terminate called after throwing an instance of 'Ort::Exception'
  what():  Exception caught: No error information
```

That is a native `terminate`, so no `try`/`catch` could contain it — the bot died and the container restarted mid-command. `transcribeAudio`, `readAudioFile`, `hasVoiceActivity`, `src/lib/audio-utils.ts`, and the `@xenova/transformers` dependency are all removed. Transcription returns in Phase 5 via the STT sidecar, **out of process**, which is the only shape that survives a native abort.

### What was broken: `/transcribe`

**Removed in Task 1.** Its continuous-streaming design (rolling per-user buffers, a grace timer reset on every decoder `data` event, force-flush races) produced fragments split mid-word. The wake-word pipeline is batch-shaped by nature — wake fires, capture one bounded utterance, endpoint on silence, transcribe once — so it inherits `/record`'s proven pattern, not this one.

### Reuse verdicts

| Piece                                                            | Verdict                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recorder.ts` subscribe / decode primitives                      | **Keep and copy.** Proven in production. Realistically ~30 lines is all the assistant shares with `/record`.                                                                                                                                                                             |
| `recorder.ts` ffmpeg-per-user, silence-gap, `amix` merge         | **Do not reuse.** These serve `/record`'s WAV deliverable. The assistant needs no files, no merging, and no time-alignment — VAD handles gaps.                                                                                                                                           |
| `src/lib/audio-utils.ts` — `convertPcmToFloat32MonoResample`     | **Deleted, do not resurrect.** 48k/16k is exactly 3, so `t` was always 0 and the "linear interpolation" degenerated to taking every third sample with no anti-alias filter, folding everything above 8 kHz into the speech band. Resample with ffmpeg (`-ar 16000`) or a real resampler. |
| `recorder.ts` — `transcribeAudio` (`@xenova`)                    | **Deleted.** Crashed the process. Replaced by the sidecar in Phase 5.                                                                                                                                                                                                                    |
| `src/lib/transcription.ts` + `/transcribe` + `transcribe_config` | **Deleted.** Task 1.                                                                                                                                                                                                                                                                     |

### Critical constraint: Lavalink + `@discordjs/voice` coexistence

> **Corrected 2026-08-25 (second revision).** An earlier revision of this document declared this a false alarm. That was wrong, and the reasoning behind the mistake is recorded below so it is not repeated.

**A receive connection cannot be established while Lavalink already owns the guild's voice session.**

`@discordjs/voice` needs both `VOICE_STATE_UPDATE` (session id) and `VOICE_SERVER_UPDATE` (token + endpoint) before it can open its voice websocket. When the bot is already in the channel via Lavalink, sending OP4 produces the state update — the bot visibly undeafens and mutes — but Discord issues **no new `VOICE_SERVER_UPDATE`**, because the voice server has not changed. The connection stays in `Signalling` until `entersState` times out after 20 s:

```
ERROR - Recording error: AbortError: The operation was aborted
```

Music is entirely unaffected: Lavalink's session is never disturbed, and player position ticks straight through the failure.

**Why this looked fixed and was not.** Before the receive connection was released at the end of `/record`, a connection established earlier — when no music was playing — persisted. `getOrCreateVoiceConnection` found it, skipped `entersState`, and returned it, so no abort occurred. That run produced silence (the bot was deafened), and "no abort" was misread as "coexistence works". Once the connection was correctly released, every `/record` had to establish a fresh session and the real constraint reappeared.

**The lesson worth keeping: a reused connection proves nothing about whether a new one can be established.** Test this constraint only from a cold voice state.

### What is still unproven

Whether receive _functions_ alongside playback once a connection is established. The one time a live connection existed during playback it was deafened, so the resulting silence is not evidence either way. **Establish this before Phase 3** — the whole assistant depends on it.

### The single voice state, and its hazards

A guild has exactly one gateway voice state. Three hazards follow, all now fixed, and none of which the assistant may reintroduce:

1. **`deaf: true` on player creation silently kills reception.** A deafened bot receives nothing, with no error — the recording succeeds and the audio is silence. `getOrCreatePlayer` now derives the flag from `!getVoiceConnection(guildId)`.
2. **An orphaned `VoiceConnection` is process-fatal.** Kazagumo destroys the gateway session of a connection it has no player for (`Connection exist but player not found`), and the orphan then throws `Cannot perform IP discovery - socket closed`. `VoiceConnection` is an `EventEmitter`, so an `'error'` with no listener terminates the process. `getOrCreateVoiceConnection` now attaches a listener.
3. **Destroying a connection sends `channel_id: null`** and disconnects the bot outright, stopping music. Only destroy when no Kazagumo player exists.

Hazard 2 generalizes: **any EventEmitter in the voice path needs an `'error'` listener.** The assistant adds worker threads, decoders, and an HTTP client — each is a process-fatal crash waiting to happen.

### Ordering, and the options

Because the constraint is about _establishing_ a session, order decides everything:

- **receive first, then music** — the connection is already `Ready`, and Lavalink connecting afterward does not tear it down
- **music first, then receive** — fails, every time

That gives three viable paths, to be decided before Phase 2 since Task 6 binds to whichever connection owns receive:

| Option                                         | Cost                                                                                   | Consequence                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Second bot token**                           | a second Discord app, a second gateway client, new env + ops                           | Full independence. Receive and playback never contend. The plan's original fallback.                   |
| **Assistant owns the connection, joins first** | assistant must join before any playback and hold the connection for the session's life | Works within one token, but `/assistant on` fails if music is already playing, and a restart loses it. |
| **Never release while a player exists**        | keeps a connection alive across `/record` runs                                         | Papers over it — the first `/record` after a restart with music already playing still fails.           |

## Target Architecture

```
Discord VC
    │  Opus 48kHz stereo, per-user SSRC
    ▼
┌──────────────────── MAIN THREAD (bot) ────────────────────┐
│  VoiceReceiver.subscribe(userId, Manual)                  │
│      └─> prism.opus.Decoder ──> s16le 48k stereo          │
│             └─> resample via ffmpeg -ar 16000              │
│                    └─> Float32 16k mono, 80ms frames      │
│                           │                                │
│                           │  postMessage(transferable)     │
└───────────────────────────┼────────────────────────────────┘
                            ▼
┌─────────────── WORKER THREAD (voice-detect) ──────────────┐
│  ring buffer (~2s) per user                               │
│  openWakeWord (ONNX, CPU)  ──── score < thresh ─> discard  │
│         │ wake hit                                         │
│         ▼                                                  │
│  Silero VAD ─ capture until 600ms silence / 8s cap         │
│         │  ONE bounded utterance (batch, like /record)     │
└─────────┼──────────────────────────────────────────────────┘
          │  postMessage({ userId, pcm16k })
          ▼
┌──────────────────── MAIN THREAD (bot) ────────────────────┐
│  sttClient.transcribe(pcm) ──HTTP──> [ STT SIDECAR ]      │
│                                       faster-whisper       │
│                                       small.en / float16   │
│                                       CUDA (2080 Super)    │
│         │  transcript                                      │
│         ▼                                                  │
│  intents.parse()  grammar → fuzzy → confidence gate        │
│         │  { intent: 'skip', slots: {}, confidence: 0.94 } │
│         ▼                                                  │
│  permission check (checkDJPermission, opt-out)             │
│         ▼                                                  │
│  musicActions.skip(guildId, member)  ◀── shared with       │
│         │                                 REST routes      │
│         ▼                                                  │
│  ack: text message  (Phase 5: Piper/Kokoro TTS)           │
└────────────────────────────────────────────────────────────┘
```

**Latency budget** (end of speech → action): wake detect ~80 ms · VAD endpoint 600 ms · STT 150–400 ms · intent <5 ms · dispatch <50 ms ≈ **~1.0–1.2 s**, dominated by the deliberate silence window.

---

## File Map

Status reflects what is actually on `main` as of 2026-08-25.

| File                                   | Status                | Responsibility                                                              |
| -------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `src/lib/transcription.ts`             | **Deleted**           | was broken streaming transcription                                          |
| `src/commands/music/transcribe.ts`     | **Deleted**           | was `/transcribe`                                                           |
| `src/lib/audio-utils.ts`               | **Deleted**           | was the aliasing resample — do not resurrect                                |
| `src/commands/General/config.ts`       | **Done**              | transcribe group stripped                                                   |
| `src/lib/config.ts`                    | Modify                | transcribe helpers removed; voice-assistant config to add                   |
| `src/lib/database.ts`                  | **Done**              | `transcribe_config` dropped; 3 tables + 1 index added                       |
| `src/lib/musicActions.ts`              | **Done**              | shared, interaction-free music service layer                                |
| `src/lib/voice/connection.ts`          | **Done**              | `ensureReceiveConnection`, `reassertUndeafened`, `releaseReceiveConnection` |
| `src/lib/musicCommandHelpers.ts`       | **Done**              | `deaf` from receive state; `'error'` listener on connections                |
| `src/lib/recorder.ts`                  | **Done**              | transcription stripped; capture untouched and working                       |
| `src/commands/music/record.ts`         | **Done**              | uses `ensureReceiveConnection`; releases it in `finally`                    |
| `src/lib/voice/types.ts`               | Create                | shared types for pipeline + worker messages                                 |
| `src/lib/voice/audioSource.ts`         | Create                | per-user Opus -> 16 kHz mono frame emitter                                  |
| `src/lib/voice/detectWorker.ts`        | Create                | worker thread: openWakeWord + Silero VAD                                    |
| `src/lib/voice/sttClient.ts`           | Create                | HTTP client for the STT sidecar, health/fallback                            |
| `src/lib/voice/intents.ts`             | Create                | grammar + fuzzy intent parsing, slot extraction                             |
| `src/lib/voice/dispatch.ts`            | Create                | intent -> permission check -> `musicActions`                                |
| `src/lib/voice/session.ts`             | Create                | per-guild session lifecycle, worker ownership                               |
| `src/commands/music/assistant.ts`      | Create                | `/assistant on\|off\|status\|optout`                                        |
| `src/listeners/voiceAssistantState.ts` | Create                | `voiceStateUpdate` -> add/remove users, re-assert deaf                      |
| `Dockerfile`                           | **Modify — Task 4.5** | Alpine -> Debian-slim, so ONNX Runtime works                                |
| `docker-compose.yml`                   | Modify                | add `stt` sidecar service                                                   |
| `docker/stt/Dockerfile`                | Create                | CUDA + faster-whisper server image                                          |
| `src/.env.example`                     | Modify                | `STT_URL`, `VOICE_ASSISTANT_ENABLED`, model paths                           |

---

## Task 1: Remove `/transcribe` and Related Utilities

> **DONE.** Shipped. `audio-utils.ts` was additionally deleted later, when `/record`'s transcription was stripped.

Do this first and land it as its own commit. It's pure deletion, it shrinks the surface the assistant has to reason about, and it removes a broken feature users can currently invoke.

**Files:** Delete `src/lib/transcription.ts`, `src/commands/music/transcribe.ts`; modify `src/commands/General/config.ts`, `src/lib/config.ts`, `src/lib/database.ts`

- [ ] **Step 1: Delete the command and library**

```bash
rm src/commands/music/transcribe.ts
rm src/lib/transcription.ts
```

Sapphire auto-loads from `src/commands`, so no registry edit is needed. The stale `/transcribe` application command clears on the next command re-registration.

- [ ] **Step 2: Strip transcribe config from `src/commands/General/config.ts`**

- Line 4: drop `getTranscribeConfig, setTranscribeConfig` from the import; keep `getMusicConfig, setMusicConfig`
- Lines ~20–31: remove the entire `transcribe` subcommand group builder (`min_audio_seconds`, `interval_ms`, `chunk_s` options)
- Lines ~87–100: remove transcribe settings from the `view` output; keep the music block
- Lines ~102–123: remove the `group === 'transcribe' && sub === 'set'` branch
- Line ~157: update the `messageRun` usage string to drop `%config transcribe set ...`
- Lines ~163–167: remove transcribe settings from the `messageRun` view output
- Lines ~170–189: remove the `transcribe-set` / `transcribe set` branch

- [ ] **Step 3: Remove config helpers from `src/lib/config.ts`**

Delete the `TranscribeConfig` type, `getTranscribeConfig`, and `setTranscribeConfig`. Leave `MusicConfig` and its helpers alone.

- [ ] **Step 4: Drop the table in `src/lib/database.ts`**

Remove the `CREATE TABLE IF NOT EXISTS transcribe_config` block and replace it with a one-line cleanup, following the destructive-migration precedent already set by the `command_permissions` block:

```typescript
// /transcribe was removed; its config table is no longer read by anything.
db.exec(`DROP TABLE IF EXISTS transcribe_config`);
```

This is destructive but harmless — the table only held three tuning knobs for a feature that no longer exists. If you'd rather keep the rows for reference, just delete the `CREATE TABLE` block and leave the table orphaned.

- [ ] **Step 5: Verify nothing else references it**

```bash
grep -rn "transcription\|Transcribe\|transcribe_config" src/ web/
```

Expect zero hits outside `src/lib/recorder.ts` (which has its own self-contained `transcribeAudio` for `/record`) and `docs/`. **Do not touch `recorder.ts`.** Keep `@xenova/transformers` in `package.json` — `recorder.ts` still imports it.

- [ ] **Step 6: Update docs.** Remove `/transcribe` from `docs/features/COMMANDS.md` and any mention in `docs/music.md`.

- [ ] **Step 7:** `yarn typecheck`, then smoke-test that `/record` and `/config view` both still work.

---

## Task 2: Database Tables

> **DONE.** Shipped verbatim; the three tables and the index exist. No accessors yet — later tasks add them.

**Files:** Modify `src/lib/database.ts`

- [ ] **Step 1: Append after the `guild_meta` block**

```typescript
db.exec(
	`CREATE TABLE IF NOT EXISTS voice_assistant_config (
		guild_id         TEXT PRIMARY KEY,
		enabled          INTEGER DEFAULT 0,
		wake_word        TEXT    DEFAULT 'hey_lyra',
		sensitivity      REAL    DEFAULT 0.5,
		require_dj       INTEGER DEFAULT 1,
		ack_mode         TEXT    DEFAULT 'text',
		text_channel_id  TEXT,
		silence_ms       INTEGER DEFAULT 600,
		max_utterance_ms INTEGER DEFAULT 8000
	)`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS voice_assistant_optout (
		guild_id TEXT NOT NULL,
		user_id  TEXT NOT NULL,
		PRIMARY KEY (guild_id, user_id)
	)`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS voice_command_log (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		user_id     TEXT NOT NULL,
		transcript  TEXT NOT NULL,
		intent      TEXT,
		confidence  REAL,
		dispatched  INTEGER DEFAULT 0,
		created_at  TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_log_guild_time ON voice_command_log (guild_id, created_at DESC)`);
```

`voice_command_log` stores **transcripts only, never audio**, and exists for tuning the intent grammar. Retention sweep in Task 11.

- [ ] **Step 2:** `yarn typecheck`

---

## Task 3: Extract the Shared Music Service Layer

> **DONE, with one deviation.** `ActionResult` had to become generic — `ActionResult<T>` carrying a `data` payload plus an `ActionErrorCode` discriminant — because the routes return structured JSON (`{track}`, `{paused}`, `{volume}`, `{mode}`) and distinguish 404 from 400. A bare `{ ok, message }` could not preserve either. Routes keep their own guards, so status codes and bodies are unchanged.

The REST routes already prove every music action can run without an `Interaction`. `skip.post.ts` is a thin `player.skip()`; `play.post.ts` has real logic inline. Voice dispatch needs the same operations, so extract them once rather than adding a third copy.

**Files:** Create `src/lib/musicActions.ts`; modify the `[guild]` routes to call it

- [ ] **Step 1: Create `src/lib/musicActions.ts`**

```typescript
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function play(guildId: string, member: GuildMember, query: string): Promise<ActionResult>;
export async function skip(guildId: string, count?: number): Promise<ActionResult>;
export async function pause(guildId: string, paused: boolean): Promise<ActionResult>;
export async function stop(guildId: string): Promise<ActionResult>;
export async function setVolume(guildId: string, volume: number): Promise<ActionResult>;
export async function shuffle(guildId: string): Promise<ActionResult>;
export async function setLoop(guildId: string, mode: 'none' | 'queue' | 'track'): Promise<ActionResult>;
export function nowPlaying(guildId: string): ActionResult;
export function queueSummary(guildId: string, limit?: number): ActionResult;
```

Move the body of `play.post.ts` (search → `getOrCreatePlayer` → `initPlayerMeta` → `queueAndLabel`) into `play()`. Reuse `searchTracks`, `getOrCreatePlayer`, `initPlayerMeta` from `musicCommandHelpers.ts`. Keep `PlayerMeta.interaction: null` for non-slash callers, as `play.post.ts` already does.

- [ ] **Step 2: Refactor routes to delegate**

`skip.post.ts`, `pause.post.ts`, `stop.post.ts`, `volume.post.ts`, `shuffle.post.ts`, `loop.post.ts`, `play.post.ts` keep their auth/`requireDJ` guards, then call `musicActions.*` and map `ActionResult` to `response.json` / `response.error`. Behavior must not change.

- [ ] **Step 3:** `yarn typecheck` and smoke-test the web dashboard — play, skip, pause, volume all still work.

---

## Task 4: Receive-Connection Ownership

> **DONE, differently than written.** The `isAssistantActive` stub was dropped: the right predicate turned out to be "is anything receiving on this guild", which `getVoiceConnection(guildId)` already answers and which covers the assistant too. `connection.ts` also gained `releaseReceiveConnection`, and `getOrCreateVoiceConnection` gained an `'error'` listener — see the coexistence hazards above.

**Files:** Create `src/lib/voice/connection.ts`; modify `src/lib/musicCommandHelpers.ts`

- [ ] **Step 1: Create `ensureReceiveConnection(guild, channel)`**

Wraps `getVoiceConnection` / `joinVoiceChannel({ selfDeaf: false, selfMute: true })` and `entersState(..., Ready, 20_000)` — the same shape as `getOrCreateVoiceConnection`, but additionally exports `reassertUndeafened(guildId)`, which checks `guild.members.me.voice.selfDeaf` and re-issues the voice state update if the bot got deafened.

- [ ] **Step 2: Make Kazagumo player creation assistant-aware**

In `getOrCreatePlayer`, change the hardcoded `deaf: true` to `deaf: !getVoiceConnection(opts.guildId)` — never deafen while anything is receiving on the guild. `getVoiceConnection` is only truthy when we opened a receive connection, since Lavalink does not create them, so this covers both `/record` and the assistant without a session-manager dependency. **As shipped**, replacing the `isAssistantActive` stub this step originally specified.

- [ ] **Step 3:** `yarn typecheck`, then verify `/record` still captures audio while music plays.

---

## Task 4.5: Move the Base Image off Alpine

**Files:** Modify `Dockerfile`

> **Added 2026-08-25. Blocks Phase 3.** This is not optional cleanup — Task 7 cannot be built until it is done.

`Dockerfile` is `node:24-alpine` with `libc6-compat`. ONNX Runtime ships glibc-oriented prebuilds, and the shim does not hold: in production, loading a model threw `Ort::Exception` and called `terminate`, killing the bot outright. That is the same runtime Task 7 needs for openWakeWord, so wake-word detection is blocked on the same defect that killed `/record`'s transcription.

- [ ] **Step 1:** Move to `node:24-slim` (Debian). Port the `apk add` lines to `apt-get install`, keep ffmpeg available, and drop `libc6-compat`.
- [ ] **Step 2:** Confirm the native modules that already build on Alpine still build: `better-sqlite3`, `@discordjs/opus`, `@sapphire/type`.
- [ ] **Step 3:** Prove ONNX Runtime actually loads before building anything on it. `yarn add onnxruntime-node`, then load any `.onnx` model in the container and run one inference. If this still fails on Debian, Task 7 must fall back to a Python detection sidecar and the plan needs revising again — find that out here, not in Task 7.
- [ ] **Step 4:** `yarn check`, deploy, and confirm the image size and cold-start time are acceptable.

---

## Task 5: STT Sidecar

**Files:** Create `docker/stt/Dockerfile`; modify `docker-compose.yml`, `src/.env.example`; create `src/lib/voice/sttClient.ts`

Per the GPU addendum: faster-whisper `small.en`, `compute_type="float16"` (**never `bfloat16`** — unsupported on the 2080 Super's compute capability 7.5, silently falls back to float32).

- [ ] **Step 1: Sidecar image** based on `nvidia/cuda:12.4-cudnn9-runtime-ubuntu22.04`, running an OpenAI-compatible faster-whisper server (Speaches, or a small FastAPI wrapper). Expose `:8000`. Keep the model resident.

- [ ] **Step 2: Compose service**

```yaml
stt:
    build: ./docker/stt
    environment:
        - WHISPER_MODEL=small.en
        - COMPUTE_TYPE=float16
    deploy:
        resources:
            reservations:
                devices: [{ driver: nvidia, count: 1, capabilities: [gpu] }]
```

Add a `stt-cpu` profile with `COMPUTE_TYPE=int8` and no device reservation, so self-hosters without a GPU keep the feature.

- [ ] **Step 3: Create `src/lib/voice/sttClient.ts`**

`transcribe(pcm16k: Float32Array): Promise<string>` — wraps 16 kHz mono PCM in a WAV header, POSTs multipart to `STT_URL`, 5 s timeout. On failure, log and return `''` (never throw into the audio path). Include `isHealthy()` polled on session start, and port the hallucination filter from `recorder.ts` (`[BLANK_AUDIO]`, `[Music]`, `[Applause]`, etc.).

- [ ] **Step 4: Validate the sidecar standalone.** Write a throwaway script that feeds a WAV produced by `/record` through `sttClient` and prints the transcript. This proves the sidecar independently of any wake-word work. Do **not** wire it into `recorder.ts` yet — `/record` works today and shouldn't be disturbed mid-project.

---

## Task 6: Audio Source

**Files:** Create `src/lib/voice/audioSource.ts`, `src/lib/voice/types.ts`

- [ ] **Step 1:** Build `UserAudioSource` on `recorder.ts`'s proven subscribe/decode pattern — `receiver.subscribe(userId, { end: Manual })` → `prism.opus.Decoder` → resample — emitting **fixed 80 ms frames** of 16 kHz mono Float32 (1280 samples) instead of writing to ffmpeg. Wake-word models need a constant hop size.

**Do not reuse `convertPcmToFloat32MonoResample` — it no longer exists, and it was wrong.** At a 48k/16k ratio of exactly 3 it decimated without an anti-alias filter, folding everything above 8 kHz into the speech band. Resample through ffmpeg (`-ar 16000`, which filters correctly and is already a dependency) or a real resampler. Getting this wrong degrades every downstream stage — wake word and STT alike — and does so silently.

Attach an `'error'` listener to the Opus stream and the decoder. An unhandled `'error'` on any EventEmitter here terminates the process; that has already killed this bot once.

Handle: `speaking.on('start')` late joiners (as `recordAllUsers` does), decoder error recovery, and teardown that destroys the Opus stream and clears timers. Skip bots and opted-out users at subscribe time — never subscribe to a user who has opted out.

Deliberately **omit** the silence-gap insertion from `recorder.ts`: that exists to keep multi-track recordings time-aligned for mixing, which the assistant doesn't need. VAD handles gaps.

- [ ] **Step 2:** `yarn typecheck`

---

## Task 7: Detection Worker

**Files:** Create `src/lib/voice/detectWorker.ts`

One worker thread per **process**, not per guild — the models are a few MB and inference is sub-millisecond, so a single worker multiplexes all guilds and users cheaply.

> **Blocked on Task 4.5.** This entire task assumes `onnxruntime-node` works in the container. It currently does not — the same runtime crashed the bot with `Ort::Exception` on Alpine. Do not start Task 7 until Task 4.5 Step 3 has proven a model loads and infers.

- [ ] **Step 1: Worker setup.** `onnxruntime-node`, CPU execution provider. Load openWakeWord (melspectrogram → embedding → wake model) and Silero VAD once at startup. Keep both on CPU — GPU offload adds kernel-launch latency for no gain at this model size.

- [ ] **Step 2: Per-stream state.** Keyed `${guildId}:${userId}`: a ~2 s ring buffer, wake-score history, and a state machine `IDLE → WAKED → CAPTURING → ENDPOINTED`. On wake, include ~300 ms of pre-roll so a clipped first word still reaches STT.

- [ ] **Step 3: Message protocol** (typed in `types.ts`):

- In: `{ type: 'frame', key, pcm: Float32Array }` (transfer the underlying `ArrayBuffer`), `{ type: 'register' | 'unregister', key }`, `{ type: 'config', key, sensitivity, silenceMs, maxMs }`
- Out: `{ type: 'wake', key, score }`, `{ type: 'utterance', key, pcm, durationMs }`, `{ type: 'error', key, message }`

- [ ] **Step 4: Endpointing.** After a wake hit, capture until `silence_ms` of VAD-negative frames or `max_utterance_ms`, whichever first. Discard utterances under ~250 ms as false accepts. **This bounded-capture step is what `transcription.ts` lacked** — the utterance is complete and self-contained before STT ever sees it.

- [ ] **Step 5: Model distribution.** Do **not** commit `.onnx` files. Download to `data/models/` on first run with a checksum check, or bake into the Docker image. Add `data/models/` to `.gitignore`.

- [ ] **Step 6:** `yarn typecheck` — confirm `tsup.config.ts` emits the worker as its own entry point (it must be a real file on disk for `new Worker(path)`).

---

## Task 8: Session Manager

**Files:** Create `src/lib/voice/session.ts`

- [ ] **Step 1:** `Map<guildId, AssistantSession>` with `startAssistantSession`, `stopAssistantSession`, `isAssistantActive`. Note `getOrCreatePlayer` no longer needs this — it already derives `deaf` from `getVoiceConnection`, which the assistant's own receive connection satisfies. `isAssistantActive` is for session bookkeeping only.

- [ ] **Step 2:** On start — load config, `ensureReceiveConnection`, spin up `UserAudioSource` for each non-bot, non-opted-out member, register them with the worker, announce in the configured text channel.

- [ ] **Step 3:** On `utterance` from the worker — `sttClient.transcribe` → `intents.parse` → `dispatch`. Guard with a per-user in-flight flag so a second wake during processing is dropped rather than queued.

- [ ] **Step 4:** On stop — unregister streams, destroy sources, and **only destroy the voice connection if no Kazagumo player exists**. That check was the one thing `stopTranscriptionSession` got right; carry it forward even as the rest of that file goes away.

---

## Task 9: Intent Parsing

**Files:** Create `src/lib/voice/intents.ts`

Grammar-first, fuzzy-fallback. Whisper `small.en` on a 1–3 s command is accurate enough that a hand-written grammar beats an NLU model here, and it's debuggable.

- [ ] **Step 1: Normalize** — lowercase, strip punctuation, expand number words ("fifty" → 50), strip a leading wake-word echo ("hey lyra, skip" → "skip").

- [ ] **Step 2: Grammar table** — ordered regex list, first match wins:

| Intent       | Patterns                                                  | Slots   |
| ------------ | --------------------------------------------------------- | ------- |
| `play`       | `^(play\|put on\|queue up)\s+(?<query>.+)$`               | `query` |
| `skip`       | `^(skip\|next)( (this\|song\|track))?$`                   | —       |
| `pause`      | `^(pause\|hold on\|wait)$`                                | —       |
| `resume`     | `^(resume\|unpause\|continue\|keep going)$`               | —       |
| `stop`       | `^(stop\|shut up\|stop playing)$`                         | —       |
| `volume_set` | `^(set )?volume( to)? (?<n>\d{1,3})$`                     | `n`     |
| `volume_rel` | `^(turn it \|volume )?(?<dir>up\|down\|louder\|quieter)$` | `dir`   |
| `nowplaying` | `^(what('s\| is) (this\|playing)\|now playing)$`          | —       |
| `queue`      | `^(what's (in the )?queue\|show queue\|queue)$`           | —       |
| `shuffle`    | `^shuffle( the queue)?$`                                  | —       |
| `disconnect` | `^(leave\|disconnect\|get out)$`                          | —       |

- [ ] **Step 3: Fuzzy fallback.** No grammar match → fuzzy-match the leading token against intent verbs (Levenshtein, or add `fuse.js`). `play` is greedy on its slot, so try it last. Return a `confidence` score.

- [ ] **Step 4: Confidence gate.** ≥0.8 dispatch silently; 0.5–0.8 dispatch with an explicit ack naming what was heard; <0.5 discard silently (do **not** reply — a chatty assistant that misfires is worse than a quiet one).

---

## Task 10: Dispatch & Permissions

**Files:** Create `src/lib/voice/dispatch.ts`

- [ ] **Step 1: Authorize as the speaker, not the bot.** Resolve the `GuildMember` from the userId and run `checkDJPermission(member, guildId)` from `src/lib/music.ts` when `require_dj` is set. Voice must never be a privilege-escalation path around `DJOnly`.

- [ ] **Step 2: Enforce presence.** Reject if the speaker is no longer in the bot's voice channel (mirrors the `InVoiceWithBot` precondition).

- [ ] **Step 3: Map intent → `musicActions`.** `volume_rel` reads current volume and applies ±10, clamped 0–100. `play` passes the raw slot text to `searchTracks` — the existing YouTube → YouTube Music fallback handles imperfect transcriptions surprisingly well.

- [ ] **Step 4: Acknowledge** per `ack_mode`: `text` posts the `ActionResult.message` to the configured channel; `none` stays silent; `tts` is Phase 5.

- [ ] **Step 5: Log** transcript, intent, confidence, and dispatch outcome to `voice_command_log`.

---

## Task 11: Command, Listener, Config

**Files:** Create `src/commands/music/assistant.ts`, `src/listeners/voiceAssistantState.ts`; modify `src/lib/config.ts`

- [ ] **Step 1: Config helpers** in `config.ts` following the pattern the now-removed `getTranscribeConfig` used (defaults object when no row, `ON CONFLICT DO UPDATE`) — that shape was fine; it was the streaming logic that wasn't.

- [ ] **Step 2: `/assistant` subcommand** (`@sapphire/plugin-subcommands`, as `config.ts` does): `on`, `off`, `status`, `optout`, `optin`. Preconditions `['InVoiceWithBot']`; gate `on`/`off` behind `DJOnly`.

- [ ] **Step 3: `voiceStateUpdate` listener** — register/unregister users as they join and leave, call `reassertUndeafened` when the bot's own state changes, and auto-stop the session when the channel empties of humans.

- [ ] **Step 4: Retention sweep** — delete `voice_command_log` rows older than 30 days on startup.

---

## Privacy Requirements

Non-negotiable, and worth stating in the README since this is a public repo:

- **Opt-in per guild** (`enabled` defaults to `0`).
- **Never persist audio.** Buffers are in-memory and freed after transcription. The assistant must never write to `./recordings` — that path belongs to `/record`, which is an explicit, user-initiated, duration-bounded action with different consent semantics.
- **Announce on start**, in the text channel and ideally the voice channel status.
- **Per-user opt-out** honored at the _subscribe_ level — an opted-out user's Opus stream is never subscribed to, not merely ignored downstream.
- **Discord's voice receive is undocumented and unsupported.** It works, but is not an API guarantee.
- Recording-consent law varies by jurisdiction. Even though nothing is written to disk, real-time processing of others' speech deserves an explicit note in `docs/`.

---

## Phasing

| Phase              | Tasks     | Outcome                                                                                                          | Status                    |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **0 — Cleanup**    | 1         | `/transcribe` gone                                                                                               | **Shipped**               |
| **1 — Groundwork** | 2, 3, 4   | shared service layer, DB tables, connection ownership                                                            | **Shipped**               |
| **1.5 — Unblock**  | 4.5       | base image off Alpine so ONNX Runtime works                                                                      | **Next — blocks Phase 3** |
| **2 — Async STT**  | 5, 6      | sidecar live and validated; frame-based audio source built                                                       | Not started               |
| **3 — Wake word**  | 7, 8      | bot detects the wake word and logs utterances                                                                    | Blocked on 4.5            |
| **4 — Commands**   | 9, 10, 11 | wake-worded voice control of music. **Goal reached.**                                                            | Not started               |
| **5 — Later**      | —         | TTS acks, dashboard panel, custom wake words, and re-point `/record` at the sidecar to restore its transcription | —                         |

Phase 5's `/record` item is no longer optional polish: `/record` lost transcription entirely when the in-process ONNX path was removed, so the sidecar is how that feature comes back.

---

## Risks & Open Questions

Updated 2026-08-25 against what production actually did. Three fired; risk 1 was wrongly retired and is reinstated.

### Fired, and where they stand

1. **Lavalink/`@discordjs/voice` contention — REAL, STILL OPEN, AND STILL THE TOP RISK.** A previous revision of this document retired this as a false alarm. That was wrong. A receive connection cannot be _established_ while Lavalink holds the guild's voice session: Discord issues no fresh `VOICE_SERVER_UPDATE`, so `entersState` times out after 20 s with `AbortError: The operation was aborted`. The evidence that seemed to clear it was a connection established earlier from a cold voice state and then reused, which never exercised the failing path. **The second-bot-token fallback is back on the table.** See **Critical constraint** for the mechanism and the three options.

2. ~~**`deaf: true` on player creation will silently kill reception.**~~ **CONFIRMED AND FIXED.** This was the real bug behind "recording while music plays returns silence" — called as highest-probability, and it landed. `getOrCreatePlayer` now derives `deaf` from `!getVoiceConnection(guildId)`.
3. ~~**Confirm `/record`'s transcripts are good before Phase 3.**~~ **CONFIRMED BAD, AND WORSE THAN SUSPECTED.** The resample was not merely unfiltered, it was pure decimation: at a ratio of exactly 3 the interpolation term was always 0, so it took every third sample. Deleted along with `audio-utils.ts`; Task 6 must resample through ffmpeg. Note this was never why transcription failed — the process crashed before audio quality could matter.
4. ~~**Alpine + `onnxruntime-node`.**~~ **CONFIRMED, FIRED IN PRODUCTION.** `Ort::Exception` -> `terminate` -> SIGABRT on every `/record`. Promoted from a footnote to **Task 4.5**, because Task 7 needs the same runtime.

### Still open

5. **openWakeWord has no first-party Node binding.** The plan runs the ONNX graph directly via `onnxruntime-node`. Validate the melspectrogram -> embedding -> classifier chain in a standalone script before Task 7 — and only after Task 4.5 proves the runtime loads at all. Introspect the tensor shapes rather than assuming them; they differ between model versions. If it is painful, fall back to a Python detection sidecar alongside the STT one.
6. **Custom wake word requires training.** Start with a stock wake word to unblock; train the custom one in parallel.
7. **False accepts while music plays.** Music leaks into user mics via speakers. May need a higher threshold when a player is active, or a "two hits within 500 ms" confirmation.
8. **`tsup` worker bundling.** Confirm the worker emits as a separate entry rather than being inlined.

### New, learned the hard way

9. **An unhandled `'error'` on any EventEmitter is process-fatal.** This killed the bot twice — once via ONNX (`terminate`, uncatchable from JS) and once via an orphaned `VoiceConnection` emitting `'error'` with no listener. The assistant adds worker threads, decoders, and an HTTP client, each an EventEmitter. **Attach an `'error'` handler to every one.** Where a failure can be native rather than JS, isolate it in a child process — that is precisely why STT belongs in a sidecar.
10. **Never let a voice connection outlive its purpose.** Kazagumo destroys the gateway session of a connection it has no player for, and the orphan then throws on a closed socket. Release the receive connection when a session ends — but only when no Kazagumo player exists, since `destroy()` sends `channel_id: null` and disconnects the bot outright.
11. **Silent failure is this subsystem's default mode.** A deafened bot records silence with no error. A bad resample degrades transcripts with no error. A stale connection times out 20 s later with a generic abort. Prefer explicit assertions and logging at each stage over trusting that an absence of errors means success.

---

## Verification

No test framework exists, so each task ends with a build gate plus a manual smoke test.

**Use `yarn typecheck`, or `yarn check` for the full gate — not `yarn build:bot`.** `tsup.config.ts` sets `dts: false` and `bundle: false`, so `build:bot` is a per-file esbuild transpile that does **not** typecheck; it reports success on code with type errors. `yarn check` runs format, lint, typecheck, audit, and `web:check`.

A green gate proves very little about this subsystem. Every failure so far — the ONNX abort, the deafened recording, the orphaned connection — passed typecheck and lint cleanly. Manual verification against a live bot is the only real gate, and **container uptime is part of it**: several of these bugs produced correct-looking output while restarting the process.

**Phase 0 acceptance:** shipped and verified.

**Phase 1 acceptance:** shipped; dashboard play/skip/pause/volume/shuffle/loop verified.

**Phase 4 acceptance:**

1. `/assistant on` in a voice channel → bot joins undeafened and announces.
2. `/play` something → music starts, reception continues.
3. Say "Hey Lyra, skip" → track skips within ~1.5 s, ack posted.
4. Say "Hey Lyra, volume 40" → volume changes.
5. A non-DJ user issues a command with `require_dj=1` → denied.
6. An opted-out user says the wake word → nothing happens.
7. `/assistant off` with music playing → session stops, music continues.
