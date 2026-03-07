# Lyra Music System Implementation Status

## Completed Phases

### Phase 1 — Database Schema & Migration ✅
- `music_config` table: `guild_id, dj_role_id, default_volume, announce_tracks`
- `play_history` table: `id, guild_id, user_id, track_title, track_url, track_duration_ms, source, played_at`
- `active_sessions` table: `session_id, user_id, guild_id, created_at, expires_at`
- Index: `idx_play_history_guild_played`
- `getMusicConfig` / `setMusicConfig` functions in `src/lib/config.ts`
- `src/lib/musicHistory.ts`: `addPlayHistory`, `getPlayHistory`, `getTopTracks`, `getTopUsers`

### Phase 6 — Bug Fixes ✅
- **6a** — `QueueMetadata` interface in `src/lib/queueMetadata.ts`; `play.ts`, `playerStart.ts`, `queueEnd.ts` all use typed metadata
- **6b** — `stopTranscriptionSession` checks for active music queue before destroying voice connection
- **6c** — `messageRun` added to `play.ts`, `queue.ts`, `skip.ts`, `skipto.ts`
- **6d** — Shared PCM→Float32 conversion extracted to `src/lib/audio-utils.ts`; duplicate config-refresh block removed from `transcription.ts`

### Phase 4 — Core Music Utilities ✅
`src/lib/music.ts` exports:
- `formatDuration(ms)` — `m:ss` / `h:mm:ss`
- `buildProgressBar(current, total, length)` — visual `▬▬🔘▬▬`
- `parseTimeString(input)` — `1:30`, `90s`, `90` → ms
- `cleanTrackTitle(title)` — strip "official video" suffixes
- `checkDJPermission(member, guildId)` — respects DJ role, ManageGuild, alone-in-channel bypass
- `buildNowPlayingEmbed(queue)` — full embed with progress, filters, loop, requester
- `serializeTrack(track)` / `serializeQueue(queue)` — for API / WebSocket

### Phase 2 — Commands ✅
**2a — Core commands** (all support `/cmd` and `%cmd`):
- `nowplaying`, `pause`, `stop`, `volume`, `seek`, `remove`, `move`, `shuffle`, `loop`, `disconnect`, `search`

**2b — Play improvements:**
- `play.ts` uses `setAutocomplete(true)` and has `autocompleteRun()` (top 5 results)
- Uses `QueueMetadata` for structured metadata
- `getMusicConfig(guildId).default_volume` for per-guild default volume

**2c — Filter command** (`src/commands/music/filter.ts`):
- Subcommands: `list`, `toggle`, `preset` (EQ), `clear`
- Autocomplete for filter name and EQ preset name
- Requires `DJOnly`

**2d — Lyrics command** (`src/commands/music/lyrics.ts`):
- Uses `genius-lyrics` package
- Defaults to current track, accepts optional query override
- Splits lyrics across multiple embeds if needed

**2e — History command** (`src/commands/music/history.ts`):
- Subcommands: `list` (paginated), `stats` (top 10 tracks, top 5 DJs)

**2f — DJOnly precondition** (`src/preconditions/DJOnly.ts`):
- Applied to: `skip`, `skipto`, `stop`, `remove`, `move`, `shuffle`, `loop`, `volume`, `disconnect`
- Bypass conditions: no DJ role set, ManageGuild permission, alone in voice channel

### Phase 3 — Enhanced Player UI ✅
- `buildNowPlayingEmbed` in `src/lib/music.ts`
- `playerStart.ts` uses new embed + records play history
- `playerButtons.ts`: two rows
  - Row 1: ⏮ Previous, ⏸/▶ Pause, ⏭ Skip, ⏹ Stop, 🔁 Loop (cycles modes)
  - Row 2: 🔀 Shuffle, 🔉 Vol-, 🔊 Vol+, 📜 Lyrics, 🎛 Filters
- `playerControls.ts`: handles all new button IDs, filter select menu, DJ check for destructive actions

### Phase 7 — Config Command Updates ✅
`/config music dj-role [@role|none]` — Set/clear DJ role
`/config music default-volume <1-100>` — Set default queue volume
`/config music announce <on|off>` — Toggle track announcements
All also available via `%config music ...` text commands.

### Phase 5 — WebUI Dashboard ✅

**5b,c — REST API routes** (`src/routes/api/`):
- `GET /api/guilds` — user's shared guilds
- `GET /api/guilds/:guild/queue` — serialized queue state
- `POST /api/guilds/:guild/play` — play a query
- `POST /api/guilds/:guild/skip|pause|stop|shuffle` — basic controls
- `POST /api/guilds/:guild/volume|seek|loop|remove|move` — advanced controls
- `GET|POST /api/guilds/:guild/filters` — list/toggle filters
- `GET /api/guilds/:guild/lyrics` — lyrics for current track
- `GET /api/guilds/:guild/history?page=N&limit=N` — play history
- `GET|PATCH /api/guilds/:guild/config` — music config
Auth via Discord OAuth2 session cookie (`lyra_session`).

**5c — LyraClient.ts** updated with `api.auth` OAuth2 config (optional — only enabled if `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` env vars are set).

**5d — WebSocket server** (`src/lib/websocket.ts`):
- Attached to HTTP server after ready
- Client sends `{ type: 'subscribe', guildId }` to subscribe
- Server pushes: `trackStart`, `queueUpdate`, `disconnected`, `trackProgress` (every 1s)
- `wsPlayerStart.ts` and `wsQueueEnd.ts` listeners broadcast events

**5e — Static file serving** (`src/middlewares/StaticFiles.ts`):
- Uses `sirv` to serve `dist/web/` as SPA (single-page app)
- Only active if `dist/web/` exists (graceful degradation)

**5f — Svelte SPA** (`web/`):
- `Login.svelte` — Discord OAuth button
- `GuildSelector.svelte` — pick server
- `Dashboard.svelte` — tabs: Player, History
- `NowPlaying.svelte` — artwork, progress bar, status
- `Controls.svelte` — play input, skip/pause/stop/shuffle/volume buttons
- `Queue.svelte` — track list with remove button
- `History.svelte` — paginated play history

**5g — Build integration**:
- `yarn build` builds both bot (tsup) and web (vite)
- `yarn build:bot` builds bot only
- `yarn web:dev` / `yarn web:build` for frontend development

## Pending / Optional
- Docker/docker-compose updates (`Dockerfile` still references old `yarn build`)
- OAuth flow endpoint (`/oauth/login`, `/oauth/callback`) — handled by `@sapphire/plugin-api` internally via the `auth` config
- Custom `@me` endpoint for `/oauth/@me` — may need adding

## Environment Variables
```env
DISCORD_TOKEN=...
OWNERS=...
DISCORD_CLIENT_ID=...         # Required for WebUI OAuth
DISCORD_CLIENT_SECRET=...     # Required for WebUI OAuth
OAUTH_REDIRECT_URI=http://localhost:4000/oauth/callback
API_PORT=4000
DASHBOARD_ORIGIN=*
SQLITE_PATH=                  # Optional, defaults to ./data/word_triggers.db
```

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/music.ts` | Shared music utilities |
| `src/lib/musicHistory.ts` | Play history CRUD |
| `src/lib/queueMetadata.ts` | Typed queue metadata |
| `src/lib/audio-utils.ts` | Shared PCM→Float32 conversion |
| `src/lib/websocket.ts` | WebSocket server + broadcast helpers |
| `src/preconditions/DJOnly.ts` | DJ role precondition |
| `web/` | Svelte SPA dashboard |
