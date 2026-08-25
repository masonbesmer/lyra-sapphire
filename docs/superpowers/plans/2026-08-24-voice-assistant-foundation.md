# Voice Assistant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the non-functional `/transcribe` feature, then add an always-on, wake-word-gated voice assistant that lets users in a voice channel control existing music commands by speaking ("Hey Lyra, skip"), running fully off the main event loop and using a fully self-hosted STT stack.

**Architecture:** Per-user Opus streams are decoded on the main thread (reusing the _proven_ primitives from `recorder.ts`), downmixed/resampled to 16 kHz mono, and pushed to a **worker thread** running openWakeWord + Silero VAD. On a wake hit, the worker endpoints a discrete utterance and hands the buffer back; the session ships it to a **GPU STT sidecar** over HTTP as a single batch request. The transcript goes through a grammar-first intent parser and dispatches into a new shared `musicActions` service layer — the same layer the REST routes use — so voice, web, and slash commands share one code path.

**Tech Stack:** TypeScript, Sapphire Framework v5, better-sqlite3, discord.js v14, `@discordjs/voice`, `prism-media`, `onnxruntime-node`, `worker_threads`, faster-whisper sidecar (Docker, CUDA)

---

> **No test framework exists in this project.** TDD steps are replaced with TypeScript build verification (`yarn build:bot`) and manual smoke-test instructions.

---

## Current State

### What works: `/record`

`src/lib/recorder.ts` is the reference implementation for everything the assistant needs on the capture side, and it is known-good:

- `receiver.subscribe(userId, { end: EndBehaviorType.Manual })` per user
- `prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })` → 48 kHz stereo s16le
- `speaking.on('start')` to catch users who join mid-session
- Silence-gap insertion to keep tracks time-aligned
- `convertPcmToFloat32MonoResample()` (`src/lib/audio-utils.ts`) → 16 kHz mono Float32Array — exactly the format wake-word and STT engines want
- A **batch** transcription step: capture a discrete, bounded chunk of audio, then transcribe it as one unit

### What's broken: `/transcribe`

`src/lib/transcription.ts` is being removed. It attempts _continuous streaming_ transcription: per-user rolling buffers, a 500 ms grace timer that resets on every decoder `data` event, a 2 s interval tick, force-flush races between the tick and the `end` handler, and `processing` flags guarding re-entrancy.

**The diagnostic worth noting:** the same Whisper model, the same Opus decoder, and the same resample helper all work fine in `recorder.ts`. The difference is batch-vs-streaming chunking. That strongly suggests the failure lives in the buffering/endpointing logic — fragments flushed too small, chunks split mid-word, `chunk_length_s: 5` applied to sub-second buffers — not in the audio path or the model.

**This directly validates the assistant's design.** The wake-word pipeline is inherently batch-shaped: wake word fires → capture one bounded utterance → endpoint on silence → transcribe once. It is `recorder.ts`'s proven pattern with an automatic trigger and an automatic stop, _not_ `transcription.ts`'s continuous-stream pattern. Build on the former; delete the latter.

### Reuse verdicts

| Piece                                                                | Verdict                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/lib/audio-utils.ts` — `convertPcmToFloat32MonoResample`         | **Keep and reuse.** Shared by `recorder.ts` and the new pipeline.                               |
| `src/lib/recorder.ts` — subscribe/decode/speaking-handler primitives | **Keep untouched; copy the pattern.** `/record` must keep working.                              |
| `src/lib/recorder.ts` — `transcribeAudio` (`@xenova`)                | **Keep for now.** `/record` surfaces its output. Optionally re-point at the sidecar in Phase 5. |
| `src/lib/transcription.ts` + `/transcribe` + `transcribe_config`     | **Delete.** Task 1.                                                                             |

### Critical constraint: Lavalink + `@discordjs/voice` coexistence

Music runs through Kazagumo/Shoukaku (Lavalink), which **cannot do voice receive**. The repo works around this by opening a second, local `@discordjs/voice` connection via `getOrCreateVoiceConnection()` in `musicCommandHelpers.ts` — which is how `/record` gets audio while music may be playing.

Two landmines the assistant must handle:

1. **A guild has exactly one gateway voice state.** Lavalink and `@discordjs/voice` both try to own it. Whichever connects last wins the `selfDeaf` flag.
2. **`getOrCreatePlayer()` creates Kazagumo players with `deaf: true`.** A self-deafened bot receives no audio. If a music player is created _after_ the assistant joins, the assistant goes silent with no error. `getOrCreateVoiceConnection` joins with `selfDeaf: false`, but nothing re-asserts it afterward.

`/record` mostly dodges this because it's short-lived and usually invoked deliberately. An always-on assistant will not be so lucky. **Mitigation in Task 4.**

---

## Target Architecture

```
Discord VC
    │  Opus 48kHz stereo, per-user SSRC
    ▼
┌──────────────────── MAIN THREAD (bot) ────────────────────┐
│  VoiceReceiver.subscribe(userId, Manual)                  │
│      └─> prism.opus.Decoder ──> s16le 48k stereo          │
│             └─> convertPcmToFloat32MonoResample()         │
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

| File                                   | Status        | Responsibility                                        |
| -------------------------------------- | ------------- | ----------------------------------------------------- |
| `src/lib/transcription.ts`             | **Delete**    | Broken streaming transcription                        |
| `src/commands/music/transcribe.ts`     | **Delete**    | `/transcribe` command                                 |
| `src/commands/General/config.ts`       | Modify        | Strip the `transcribe` subcommand group               |
| `src/lib/config.ts`                    | Modify        | Remove transcribe config; add voice-assistant config  |
| `src/lib/database.ts`                  | Modify        | Drop `transcribe_config`; add 3 tables + 1 index      |
| `src/lib/musicActions.ts`              | Create        | Shared, interaction-free music service layer          |
| `src/lib/voice/types.ts`               | Create        | Shared types for pipeline + worker messages           |
| `src/lib/voice/connection.ts`          | Create        | `ensureReceiveConnection`, `selfDeaf` re-assertion    |
| `src/lib/voice/audioSource.ts`         | Create        | Per-user Opus → 16 kHz mono frame emitter             |
| `src/lib/voice/detectWorker.ts`        | Create        | Worker thread: openWakeWord + Silero VAD              |
| `src/lib/voice/sttClient.ts`           | Create        | HTTP client for the STT sidecar, health/fallback      |
| `src/lib/voice/intents.ts`             | Create        | Grammar + fuzzy intent parsing, slot extraction       |
| `src/lib/voice/dispatch.ts`            | Create        | Intent → permission check → `musicActions`            |
| `src/lib/voice/session.ts`             | Create        | Per-guild session lifecycle, worker ownership         |
| `src/commands/music/assistant.ts`      | Create        | `/assistant on\|off\|status\|optout`                  |
| `src/listeners/voiceAssistantState.ts` | Create        | `voiceStateUpdate` → add/remove users, re-assert deaf |
| `src/lib/musicCommandHelpers.ts`       | Modify        | `getOrCreatePlayer` respects active assistant session |
| `src/lib/recorder.ts`                  | **Untouched** | `/record` must keep working                           |
| `src/lib/audio-utils.ts`               | **Untouched** | Shared by both                                        |
| `docker-compose.yml`                   | Modify        | Add `stt` sidecar service                             |
| `docker/stt/Dockerfile`                | Create        | CUDA + faster-whisper server image                    |
| `src/.env.example`                     | Modify        | `STT_URL`, `VOICE_ASSISTANT_ENABLED`, model paths     |

---

## Task 1: Remove `/transcribe` and Related Utilities

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

- [ ] **Step 7:** `yarn build:bot`, then smoke-test that `/record` and `/config view` both still work.

---

## Task 2: Database Tables

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

- [ ] **Step 2:** `yarn build:bot`

---

## Task 3: Extract the Shared Music Service Layer

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

- [ ] **Step 3:** `yarn build:bot` and smoke-test the web dashboard — play, skip, pause, volume all still work.

---

## Task 4: Receive-Connection Ownership

**Files:** Create `src/lib/voice/connection.ts`; modify `src/lib/musicCommandHelpers.ts`

- [ ] **Step 1: Create `ensureReceiveConnection(guild, channel)`**

Wraps `getVoiceConnection` / `joinVoiceChannel({ selfDeaf: false, selfMute: true })` and `entersState(..., Ready, 20_000)` — the same shape as `getOrCreateVoiceConnection`, but additionally exports `reassertUndeafened(guildId)`, which checks `guild.members.me.voice.selfDeaf` and re-issues the voice state update if the bot got deafened.

- [ ] **Step 2: Make Kazagumo player creation assistant-aware**

In `getOrCreatePlayer`, change the hardcoded `deaf: true` to `deaf: !isAssistantActive(opts.guildId)`. Import the predicate from `src/lib/voice/session.ts` (Task 8) — stub it to `() => false` until then so the build stays green.

- [ ] **Step 3:** `yarn build:bot`, then verify `/record` still captures audio while music plays.

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

- [ ] **Step 1:** Build `UserAudioSource` on `recorder.ts`'s proven subscribe/decode pattern — `receiver.subscribe(userId, { end: Manual })` → `prism.opus.Decoder` → `convertPcmToFloat32MonoResample` — but emit **fixed 80 ms frames** of 16 kHz mono Float32 (1280 samples) instead of writing to ffmpeg. Wake-word models need a constant hop size.

Handle: `speaking.on('start')` late joiners (as `recordAllUsers` does), decoder error recovery, and teardown that destroys the Opus stream and clears timers. Skip bots and opted-out users at subscribe time — never subscribe to a user who has opted out.

Deliberately **omit** the silence-gap insertion from `recorder.ts`: that exists to keep multi-track recordings time-aligned for mixing, which the assistant doesn't need. VAD handles gaps.

- [ ] **Step 2:** `yarn build:bot`

---

## Task 7: Detection Worker

**Files:** Create `src/lib/voice/detectWorker.ts`

One worker thread per **process**, not per guild — the models are a few MB and inference is sub-millisecond, so a single worker multiplexes all guilds and users cheaply.

- [ ] **Step 1: Worker setup.** `onnxruntime-node`, CPU execution provider. Load openWakeWord (melspectrogram → embedding → wake model) and Silero VAD once at startup. Keep both on CPU — GPU offload adds kernel-launch latency for no gain at this model size.

- [ ] **Step 2: Per-stream state.** Keyed `${guildId}:${userId}`: a ~2 s ring buffer, wake-score history, and a state machine `IDLE → WAKED → CAPTURING → ENDPOINTED`. On wake, include ~300 ms of pre-roll so a clipped first word still reaches STT.

- [ ] **Step 3: Message protocol** (typed in `types.ts`):

- In: `{ type: 'frame', key, pcm: Float32Array }` (transfer the underlying `ArrayBuffer`), `{ type: 'register' | 'unregister', key }`, `{ type: 'config', key, sensitivity, silenceMs, maxMs }`
- Out: `{ type: 'wake', key, score }`, `{ type: 'utterance', key, pcm, durationMs }`, `{ type: 'error', key, message }`

- [ ] **Step 4: Endpointing.** After a wake hit, capture until `silence_ms` of VAD-negative frames or `max_utterance_ms`, whichever first. Discard utterances under ~250 ms as false accepts. **This bounded-capture step is what `transcription.ts` lacked** — the utterance is complete and self-contained before STT ever sees it.

- [ ] **Step 5: Model distribution.** Do **not** commit `.onnx` files. Download to `data/models/` on first run with a checksum check, or bake into the Docker image. Add `data/models/` to `.gitignore`.

- [ ] **Step 6:** `yarn build:bot` — confirm `tsup.config.ts` emits the worker as its own entry point (it must be a real file on disk for `new Worker(path)`).

---

## Task 8: Session Manager

**Files:** Create `src/lib/voice/session.ts`

- [ ] **Step 1:** `Map<guildId, AssistantSession>` with `startAssistantSession`, `stopAssistantSession`, `isAssistantActive`. Wire the real `isAssistantActive` into Task 4's stub.

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

| Phase              | Tasks     | Outcome                                                                                                       | Effort               |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| **0 — Cleanup**    | 1         | `/transcribe` gone. Broken feature removed, surface shrunk. **Ship independently.**                           | Low, pure deletion   |
| **1 — Groundwork** | 2, 3, 4   | Shared service layer, DB, connection ownership. No user-visible change.                                       | Low, mostly refactor |
| **2 — Async STT**  | 5, 6      | Sidecar live and validated; frame-based audio source built.                                                   | Medium               |
| **3 — Wake word**  | 7, 8      | Bot detects "Hey Lyra" and logs utterances. No dispatch yet.                                                  | High — the real work |
| **4 — Commands**   | 9, 10, 11 | Wake-worded voice control of music. **Goal reached.**                                                         | Medium               |
| **5 — Later**      | —         | TTS acks (Kokoro/Piper), dashboard panel, custom wake words, optionally re-point `recorder.ts` at the sidecar | —                    |

Land Phase 0 on its own first. It's low-risk, independently valuable, and makes the rest of the work cleaner.

---

## Risks & Open Questions

1. **Lavalink/`@discordjs/voice` contention is the top risk.** Two subsystems, one voice state. Task 4 mitigates but does not eliminate it. **Verify empirically before Phase 3:** run `/record` for 30 s, start `/play` mid-recording, and confirm the recording still captures audio afterward. If Kazagumo's connect stomps the receive connection, the assistant needs a different approach (e.g. a second bot token dedicated to receive).
2. **`deaf: true` on player creation** will silently kill reception. Highest-probability actual bug.
3. **Confirm `/record`'s transcripts are actually good before Phase 3.** The batch/wake-word shape avoids `transcription.ts`'s specific chunking failure, but if `/record`'s transcription output is _also_ unreliable, the problem is upstream — and the prime suspect becomes `convertPcmToFloat32MonoResample`'s naive linear-interpolation resample, which has no anti-alias filter. 48 k → 16 k without one folds everything above 8 kHz back into the speech band. If so, replace it with a proper resampler (or let ffmpeg do it) before building anything on top.
4. **openWakeWord has no first-party Node binding.** The plan assumes running the ONNX graph directly via `onnxruntime-node`. Validate the melspectrogram → embedding → classifier chain in a standalone script _before_ Task 7; if it's painful, fall back to a Python detection sidecar alongside the STT one.
5. **Custom "Hey Lyra" wake word requires training** (openWakeWord's synthetic-data pipeline, a few hours on the 2080). Start with a stock wake word to unblock, train the custom one in parallel.
6. **False accepts while music plays.** Music leaks into user mics via speakers. May need a higher threshold when a player is active, or a "two hits within 500 ms" confirmation.
7. **`tsup` worker bundling** — confirm the worker emits as a separate entry rather than being inlined.
8. **Alpine + `onnxruntime-node`** — the Dockerfile is `node:24-alpine`; ONNX Runtime prebuilds are glibc-oriented. `libc6-compat` is already installed, but expect a possible move to a Debian-slim base.

---

## Verification

No test framework exists, so each task ends with `yarn build:bot` plus a manual smoke test.

**Phase 0 acceptance:**

1. `grep -rn "transcription\|transcribe_config" src/` returns nothing outside `recorder.ts`.
2. `/transcribe` no longer appears in the slash command list.
3. `/record 15` still works and still returns a WAV.
4. `/config view` renders without the transcribe block and without errors.

**Phase 4 acceptance:**

1. `/assistant on` in a voice channel → bot joins undeafened and announces.
2. `/play` something → music starts, reception continues.
3. Say "Hey Lyra, skip" → track skips within ~1.5 s, ack posted.
4. Say "Hey Lyra, volume 40" → volume changes.
5. A non-DJ user issues a command with `require_dj=1` → denied.
6. An opted-out user says the wake word → nothing happens.
7. `/assistant off` with music playing → session stops, music continues.
