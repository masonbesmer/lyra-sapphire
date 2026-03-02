# Plan: Lyra Music System Overhaul

A complete overhaul of Lyra's music system adding missing playback commands, audio filters, a DJ permission system, lyrics display, play history tracking, and a real-time WebUI dashboard with Discord OAuth2 authentication. All features are guild-scoped, integrate with the existing Sapphire + Discord Player v7 stack, and reuse established patterns (decorators, preconditions, SQLite prepared statements).

---

## Phase 1 — Database Schema & Migration

Extend `src/lib/database.ts` with new tables. Add migration logic alongside the existing `command_permissions` migration pattern.

### New Tables

**`music_config`** — Per-guild music settings (DJ role, 24/7 mode, default volume, etc.)

| Column            | Type    | Default | Notes                                       |
| ----------------- | ------- | ------- | ------------------------------------------- |
| `guild_id`        | TEXT PK | —       | —                                           |
| `dj_role_id`      | TEXT    | NULL    | Role required for destructive music actions |
| `default_volume`  | INTEGER | 25      | 1–100                                       |
| `announce_tracks` | INTEGER | 1       | 0/1 boolean                                 |

**`play_history`** — Track play log per guild

| Column              | Type                     | Default | Notes                   |
| ------------------- | ------------------------ | ------- | ----------------------- |
| `id`                | INTEGER PK AUTOINCREMENT | —       | —                       |
| `guild_id`          | TEXT NOT NULL            | —       | —                       |
| `user_id`           | TEXT NOT NULL            | —       | Who queued it           |
| `track_title`       | TEXT NOT NULL            | —       | —                       |
| `track_url`         | TEXT NOT NULL            | —       | —                       |
| `track_duration_ms` | INTEGER                  | 0       | —                       |
| `source`            | TEXT                     | NULL    | youtube/soundcloud/etc. |
| `played_at`         | TEXT NOT NULL            | —       | ISO 8601 timestamp      |

Index: `(guild_id, played_at DESC)` for fast per-guild history queries.

**`active_sessions`** — Track active WebUI sessions for security

| Column       | Type          | Default | Notes                           |
| ------------ | ------------- | ------- | ------------------------------- |
| `session_id` | TEXT PK       | —       | Random token                    |
| `user_id`    | TEXT NOT NULL | —       | Discord user ID                 |
| `guild_id`   | TEXT NOT NULL | —       | Which guild they're controlling |
| `created_at` | TEXT NOT NULL | —       | —                               |
| `expires_at` | TEXT NOT NULL | —       | Auto-cleanup stale sessions     |

### Migration

Add to the existing migration block in `src/lib/database.ts`:

- Check table existence via `sqlite_master` before creating
- Create all tables with `CREATE TABLE IF NOT EXISTS`
- Add indexes with `CREATE INDEX IF NOT EXISTS`

### Config Module

Extend `src/lib/config.ts` with `getMusicConfig(guildId)` and `setMusicConfig(guildId, ...)` following the existing `getTranscribeConfig` / `setTranscribeConfig` pattern (upsert with `ON CONFLICT DO UPDATE`).

Add `addPlayHistory(entry)` and `getPlayHistory(guildId, limit, offset)` to a new `src/lib/musicHistory.ts` module.

---

## Phase 2 — New Music Commands

All new commands go in `src/commands/music/`. Every command supports **both slash and message** variants (fixing the current slash-only gap). All use the `InVoiceWithBot` precondition.

### 2a. Missing Core Commands

| Command                     | File            | Description                                                                          |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `/nowplaying`               | `nowplaying.ts` | Show current track embed with progress bar, duration, requester, filters active      |
| `/pause`                    | `pause.ts`      | Toggle pause/resume (standalone alternative to button)                               |
| `/stop`                     | `stop.ts`       | Stop playback, clear queue, disconnect bot                                           |
| `/volume <1-100>`           | `volume.ts`     | Set playback volume via `queue.node.setVolume()`                                     |
| `/seek <time>`              | `seek.ts`       | Seek to position (accepts `1:30`, `90s`, `90` formats)                               |
| `/remove <position>`        | `remove.ts`     | Remove a track from the queue by position                                            |
| `/move <from> <to>`         | `move.ts`       | Move a track within the queue                                                        |
| `/shuffle`                  | `shuffle.ts`    | Shuffle upcoming tracks via `queue.tracks.shuffle()`                                 |
| `/loop <off\|track\|queue>` | `loop.ts`       | Set repeat mode via `queue.setRepeatMode()` — Off / Track / Queue / Autoplay         |
| `/disconnect`               | `disconnect.ts` | Force-disconnect the bot from voice                                                  |
| `/search <query>`           | `search.ts`     | Search YouTube/SoundCloud, show top 5 results as select menu, user picks one to play |

### 2b. Autocomplete for `/play`

Update `src/commands/music/play.ts`:

- Set `setAutocomplete(true)` on the query option
- Add `autocompleteRun()` method that calls `player.search(query)` and returns top 5 results as autocomplete choices
- Each choice shows `title — duration` as the name, URL as the value

### 2c. Filter Command

**File:** `src/commands/music/filter.ts`

Subcommand structure using `@sapphire/plugin-subcommands`:

- `/filter list` — Show all available filters and which are active (paginated embed)
- `/filter toggle <filter>` — Toggle an FFmpeg filter on/off via `queue.filters.ffmpeg.toggle()`
- `/filter preset <name>` — Apply an EQ preset (Flat, Rock, Pop, etc.) via `queue.filters.equalizer`
- `/filter clear` — Disable all filters via `queue.filters.ffmpeg.setFilters({})`
- Autocomplete for filter/preset names

Available FFmpeg filters (from discord-player): `bassboost_low`, `bassboost`, `bassboost_high`, `8D`, `vaporwave`, `nightcore`, `phaser`, `tremolo`, `vibrato`, `reverse`, `treble`, `normalizer`, `surrounding`, `pulsator`, `subboost`, `karaoke`, `flanger`, `gate`, `haas`, `mcompand`, `lofi`, `earrape`, `chorus`, `chorus2d`, `chorus3d`, `fadein`, `dim`, `softlimiter`, `compressor`, `expander`, `silenceremove`

EQ presets (18): `Flat`, `Classical`, `Club`, `Dance`, `FullBass`, `FullBassTreble`, `FullTreble`, `Headphones`, `LargeHall`, `Live`, `Party`, `Pop`, `Reggae`, `Rock`, `Ska`, `Soft`, `SoftRock`, `Techno`

### 2d. Lyrics Command

**File:** `src/commands/music/lyrics.ts`

- `/lyrics [query]` — If no query, use current track title
- Strip parentheticals and "Official Video" etc. from title for better search
- Use `genius-lyrics` npm package (or `lyrics-finder`) to fetch lyrics
- Display in paginated embed (lyrics can be long)
- Dependency to add: `genius-lyrics` (free, no API key needed for search+scrape)

### 2e. History Command

**File:** `src/commands/music/history.ts`

- `/history [page]` — Show last 20 tracks played in this guild (paginated)
- Each entry: track title (linked), who queued it, when
- `/history stats` — Top 10 most played tracks and top 5 most active users (DJs) in the guild

### 2f. DJ Role Integration

**New precondition:** `src/preconditions/DJOnly.ts`

- If `music_config.dj_role_id` is set for the guild, check if the user has that role
- Users with `ManageGuild` permission bypass the check
- If the user is alone in voice with the bot, bypass the check (nobody to disrupt)
- Apply to destructive commands: `skip`, `skipto`, `stop`, `remove`, `move`, `shuffle`, `loop`, `filter`, `volume`, `disconnect`
- Non-destructive commands (`play`, `queue`, `nowplaying`, `lyrics`, `history`, `search`) remain unrestricted

**Config integration:** Add `/config music dj-role <role>` and `/config music dj-role clear` subcommands to `src/commands/General/config.ts`.

---

## Phase 3 — Player Message & Button Enhancements

### 3a. Expanded Now Playing Embed

Update `src/listeners/playerStart.ts` to build a richer embed:

- **Progress bar**: Visual `▬▬▬🔘▬▬▬▬▬▬` style progress indicator
- **Fields**: Duration, Volume, Loop mode, Active filters, Requester, Queue length
- **Footer**: "Up next: {next track title}" or "Last track in queue"

### 3b. Expanded Button Row

Update `src/lib/playerButtons.ts` — two rows of buttons:

**Row 1 (Playback):**
| Button | ID | Emoji |
|--------|----|-------|
| Previous/Restart | `player_previous` | ⏮️ |
| Pause/Resume | `player_pause` | ⏸️/▶️ |
| Skip | `player_skip` | ⏭️ |
| Stop | `player_stop` | ⏹️ |
| Loop cycle | `player_loop` | 🔁/🔂/🔄 |

**Row 2 (Extras):**
| Button | ID | Emoji |
|--------|----|-------|
| Shuffle | `player_shuffle` | 🔀 |
| Volume down (-10) | `player_vol_down` | 🔉 |
| Volume up (+10) | `player_vol_up` | 🔊 |
| Lyrics | `player_lyrics` | 📜 |
| Filters menu | `player_filters` | 🎛️ |

The Filters button opens a **StringSelectMenu** (sent ephemeral) listing popular filters to toggle.

### 3c. Update Player Controls Listener

Extend `src/listeners/playerControls.ts` to handle all new button IDs. Each handler:

- Validates voice channel membership (existing logic)
- Checks DJ role for destructive actions (reuse `DJOnly` precondition logic as a utility function in `src/lib/music.ts`)
- Responds ephemeral with confirmation
- Re-edits the now playing embed to reflect state changes

### 3d. Play History Recording

In `src/listeners/playerStart.ts`, after sending the now-playing message, insert a row into `play_history` via `addPlayHistory()`. Extract requester ID from `queue.metadata` (the interaction user).

---

## Phase 4 — Core Music Utilities Module

**New file:** `src/lib/music.ts` — Shared music logic extracted from commands/listeners:

- `formatDuration(ms)` — `3:45` style formatting
- `buildProgressBar(current, total, length=12)` — Visual progress bar string
- `parseTimeString(input)` — Parse `1:30`, `90s`, `90` → milliseconds
- `cleanTrackTitle(title)` — Strip "(Official Video)", "[Lyrics]", etc. for lyrics search
- `checkDJPermission(member, guildId)` — Reusable DJ role check (returns boolean)
- `getQueueOrFail(guild)` — Get queue or throw user-friendly error
- `buildNowPlayingEmbed(queue)` — Centralized embed builder used by `/nowplaying`, `playerStart` listener, and WebUI API
- `serializeQueue(queue)` — Convert queue state to JSON for WebUI consumption
- `serializeTrack(track)` — Convert a GuildQueuePlayerNode track to a plain JSON object

---

## Phase 5 — WebUI Dashboard

### 5a. Architecture

```
┌─────────────┐      WebSocket (ws)       ┌──────────────────┐
│  SPA Client │ ◄──────────────────────── │  Lyra Bot Server  │
│  (Svelte)   │ ──── REST API ──────────► │  Sapphire API     │
│  Port 5173  │                           │  Port 4000        │
│  (dev only) │                           │  Serves dist/web  │
└─────────────┘                           └──────────────────┘
```

**Frontend**: Svelte (lightweight, minimal deps, fast build). Located at `web/` in the project root.
**Bundler**: Vite — outputs to `dist/web/` which the bot serves as static files.
**Communication**: REST for commands/auth, WebSocket for real-time state pushes.

### 5b. Authentication — Discord OAuth2

**Server-side** — Configure `@sapphire/plugin-api`'s built-in OAuth2 in `src/LyraClient.ts`:

```
api: {
  auth: {
    id: process.env.DISCORD_CLIENT_ID,
    secret: process.env.DISCORD_CLIENT_SECRET,
    redirect: process.env.OAUTH_REDIRECT_URI,
    scopes: [OAuth2Scopes.Identify, OAuth2Scopes.Guilds],
  },
  listenOptions: { port: parseInt(process.env.API_PORT || '4000') },
  origin: process.env.DASHBOARD_ORIGIN || '*',
}
```

New env vars in `src/.env`:

- `DISCORD_CLIENT_ID` — Application ID
- `DISCORD_CLIENT_SECRET` — OAuth2 secret
- `OAUTH_REDIRECT_URI` — e.g. `http://localhost:4000/oauth/callback`
- `API_PORT` — defaults to 4000
- `DASHBOARD_ORIGIN` — CORS origin for production

Sapphire auto-registers `/oauth/callback` and `/oauth/logout` routes. The SPA redirects users to Discord's OAuth2 URL, Discord redirects back to `/oauth/callback`, the plugin sets an encrypted auth cookie, and subsequent API requests include `request.auth` with the user's Discord identity and guild list.

### 5c. API Routes

All new routes in `src/routes/`. Auth-protected routes check `request.auth` and verify guild membership/permissions.

**Guild Selection:**
| Route | Method | Description |
|-------|--------|-------------|
| `/api/guilds` | GET | Return guilds where user + bot are both members (filter user's guilds against bot's cache) |

**Music Control (all require auth + guild membership):**
| Route | Method | Description |
|-------|--------|-------------|
| `/api/guilds/[guild]/queue` | GET | Current queue state (serialized via `serializeQueue`) |
| `/api/guilds/[guild]/play` | POST | Add track to queue (`{ query }`) |
| `/api/guilds/[guild]/skip` | POST | Skip current track |
| `/api/guilds/[guild]/pause` | POST | Toggle pause |
| `/api/guilds/[guild]/stop` | POST | Stop & clear |
| `/api/guilds/[guild]/volume` | POST | Set volume (`{ volume }`) |
| `/api/guilds/[guild]/seek` | POST | Seek to position (`{ position }`) |
| `/api/guilds/[guild]/shuffle` | POST | Shuffle queue |
| `/api/guilds/[guild]/loop` | POST | Set loop mode (`{ mode }`) |
| `/api/guilds/[guild]/remove` | POST | Remove track (`{ position }`) |
| `/api/guilds/[guild]/move` | POST | Move track (`{ from, to }`) |
| `/api/guilds/[guild]/filters` | GET | Active filters list |
| `/api/guilds/[guild]/filters` | POST | Toggle filter (`{ filter }`) |
| `/api/guilds/[guild]/lyrics` | GET | Lyrics for current track |
| `/api/guilds/[guild]/history` | GET | Play history (paginated `?page=&limit=`) |
| `/api/guilds/[guild]/config` | GET | Music config for guild |
| `/api/guilds/[guild]/config` | PATCH | Update music config (DJ role, etc.) |

**Route parameter handling:** Sapphire's API plugin supports path segments via directory structure. Create `src/routes/api/guilds/[guild]/queue.get.ts`, etc. Access the guild param via `request.params.guild`.

**Auth middleware pattern for all guild routes:**

1. Check `request.auth` is non-null (→ 401)
2. Fetch user's guilds from `request.auth` data
3. Verify bot is in the guild (→ 404)
4. Verify user is in the guild (→ 403)
5. For destructive actions, check DJ role permission

### 5d. WebSocket Server

**File:** `src/lib/websocket.ts`

- Create a `WebSocket.Server` attached to the Sapphire HTTP server (share the same port via `server.on('upgrade')`)
- Add `ws` as a direct dependency in `package.json` (currently only a transitive dep)
- **Connection auth:** Client sends `{ type: 'auth', token: '<sapphire_auth_cookie>' }` on connect. Server decrypts the cookie, validates session, associates the socket with a user + guild.
- **Guild subscription:** Client sends `{ type: 'subscribe', guildId: '...' }`. Server validates membership and starts pushing state.

**Server → Client events:**
| Event | Payload | Trigger |
|-------|---------|---------|
| `queueUpdate` | Full serialized queue | Track add/remove/reorder/clear |
| `trackStart` | Current track info + progress | New track starts |
| `trackProgress` | `{ position, duration }` | Every 1s while playing |
| `pauseStateChange` | `{ paused }` | Pause/resume |
| `volumeChange` | `{ volume }` | Volume adjusted |
| `filterChange` | `{ active: [...] }` | Filters toggled |
| `loopChange` | `{ mode }` | Loop mode changed |
| `disconnected` | `{}` | Bot left voice |

**Implementation:** Hook into discord-player events (same ones already listened to in `LyraClient` constructor) and broadcast to all WebSocket clients subscribed to that guild. Create a `GuildBroadcaster` class that manages per-guild subscriber sets.

**Track progress:** Use a `setInterval(1000)` per active guild that pushes `trackProgress` with `queue.node.getTimestamp()`.

### 5e. Static File Serving

**New middleware:** `src/middlewares/StaticFiles.ts`

Sapphire's API plugin supports custom middleware. Create a middleware at position 5 (before other middleware) that:

- Checks if the request path starts with `/` and doesn't start with `/api` or `/oauth`
- Serves files from `dist/web/` directory
- Falls back to `index.html` for SPA routing (any non-file path returns the SPA shell)
- Sets proper MIME types and caching headers

Alternatively, use the `sirv` npm package (tiny, zero-dep static file server) within the middleware.

### 5f. Frontend SPA (Svelte)

**Location:** `web/` directory in project root.

**Structure:**

```
web/
  package.json          # Svelte + Vite deps
  vite.config.ts        # Output to ../dist/web/
  tsconfig.json
  index.html
  src/
    App.svelte          # Root: router + auth context
    lib/
      api.ts            # REST client (fetch wrapper with auth cookie)
      ws.ts             # WebSocket client with reconnection
      stores.ts         # Svelte stores for queue state, user, guild
      types.ts          # Shared TypeScript interfaces
    routes/
      Login.svelte      # "Login with Discord" button → OAuth2 redirect
      GuildSelect.svelte # Grid of guilds where bot is present
      Dashboard.svelte  # Main music control panel
    components/
      NowPlaying.svelte # Current track card with artwork, progress, title
      ProgressBar.svelte # Clickable seek bar
      QueueList.svelte  # Drag-to-reorder queue (via move API)
      Controls.svelte   # Play/Pause/Skip/Stop/Prev/Shuffle/Loop buttons
      VolumeSlider.svelte
      FilterPanel.svelte # Grid of toggleable filter chips
      LyricsPanel.svelte # Scrollable lyrics display
      HistoryList.svelte # Paginated play history
      SearchBar.svelte  # Search + add to queue
```

**Key UX behaviors:**

- **Real-time sync**: All state from WebSocket, controls send REST then optimistically update UI
- **Progress bar**: Smooth client-side interpolation between 1s server ticks, clickable to seek
- **Queue drag-and-drop**: Reorder tracks, calls `/move` API
- **Responsive**: Mobile-friendly grid layout (phone-in-hand use case)
- **Dark theme**: Match Discord's dark aesthetic

### 5g. Build Integration

Update root `package.json` scripts:

- `"build:web": "cd web && npm run build"` — builds SPA to `dist/web/`
- `"build": "tsup && npm run build:web"` — builds both bot + web
- `"dev:web": "cd web && npm run dev"` — Vite dev server on port 5173 with proxy to port 4000

Update `.gitignore` to include `dist/web/`.
Update `Dockerfile` to install web dependencies and build the SPA.

---

## Phase 6 — Fix Existing Issues

### 6a. Metadata Type Safety

The queue `metadata` is currently typed loosely. Create a proper interface:

```
interface QueueMetadata {
  interaction: ChatInputCommandInteraction | Message;
  channelId: string;
  requestedBy: User;
}
```

Update `src/commands/music/play.ts` to pass this structured metadata. Update `playerStart.ts` and `queueEnd.ts` to use the typed metadata. This also supports tracks queued via the WebUI (where `interaction` would be null but `channelId` and `requestedBy` are set from the API request's auth context).

### 6b. Transcription/Music Conflict

`stopTranscriptionSession()` currently destroys the voice connection, killing any active music. Fix by:

- Checking if a music queue exists for the guild before destroying
- If music is active, only stop the transcription listeners/decoders without touching the connection
- Add a warning message if both systems are active simultaneously

### 6c. Dual Command Support

Add `messageRun()` to `play.ts`, `queue.ts`, `skip.ts`, `skipto.ts` — currently slash-only. Follow the pattern from `record.ts` which supports both. Parse arguments via Sapphire's `Args` class.

### 6d. Duplicated Code Cleanup

- Extract shared PCM→Float32 resampling logic from `recorder.ts` and `transcription.ts` into `src/lib/audio-utils.ts`
- Remove the duplicated config-refresh block in `transcription.ts` (lines ~224-234)

---

## Phase 7 — Config Command Updates

Extend `src/commands/General/config.ts` with music subcommands:

- `/config music dj-role <role>` — Set DJ role
- `/config music dj-role clear` — Remove DJ role restriction
- `/config music default-volume <1-100>` — Set default volume for new queues
- `/config music announce <on|off>` — Toggle track announcement messages
- `/config view` — Update to also show music config alongside transcribe config

Message command equivalents:

- `%config music dj-role @DJs`
- `%config music default-volume 30`
- `%config music announce off`

---

## Implementation Order

1. **Phase 1** — Database schema + migration (foundation for everything)
2. **Phase 6a,c,d** — Fix existing issues (clean base before adding features)
3. **Phase 4** — Core music utilities module (shared by all new features)
4. **Phase 2a,b** — Core missing commands (nowplaying, pause, stop, volume, seek, etc.)
5. **Phase 3** — Enhanced player messages + buttons
6. **Phase 2f** — DJ role precondition + Phase 7 config updates
7. **Phase 2c** — Filter command
8. **Phase 2d** — Lyrics command
9. **Phase 2e** — History command + Phase 3d history recording
10. **Phase 6b** — Transcription conflict fix
11. **Phase 5b,c** — API auth + REST routes
12. **Phase 5d** — WebSocket server
13. **Phase 5e,f** — Frontend SPA + static serving
14. **Phase 5g** — Build integration + Docker

---

## New Dependencies

| Package                        | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `ws`                           | WebSocket server (move from transitive to direct dep) |
| `genius-lyrics`                | Lyrics fetching (no API key)                          |
| `sirv`                         | Static file serving middleware                        |
| `svelte`                       | Frontend framework (in `web/package.json`)            |
| `vite`                         | Frontend build tool (in `web/package.json`)           |
| `@sveltejs/vite-plugin-svelte` | Svelte Vite integration                               |

## New Environment Variables

| Variable                | Required        | Default                                | Purpose               |
| ----------------------- | --------------- | -------------------------------------- | --------------------- |
| `DISCORD_CLIENT_ID`     | Yes (for WebUI) | —                                      | OAuth2 application ID |
| `DISCORD_CLIENT_SECRET` | Yes (for WebUI) | —                                      | OAuth2 client secret  |
| `OAUTH_REDIRECT_URI`    | No              | `http://localhost:4000/oauth/callback` | OAuth2 redirect       |
| `API_PORT`              | No              | `4000`                                 | HTTP/WS server port   |
| `DASHBOARD_ORIGIN`      | No              | `*`                                    | CORS origin           |

---

## Verification

### Unit/Integration Testing

- Test all new commands with both slash and message invocations
- Test DJ role precondition: with role set, without role set, user alone in voice, user with ManageGuild
- Test filter toggle/clear via command and verify audio output changes
- Test history recording on track start and retrieval via command
- Test lyrics fetching with various track titles (clean title stripping)

### WebUI Testing

- OAuth2 flow: login → guild select → dashboard
- Real-time: play a track via Discord, verify WebUI updates within 1s
- Control parity: every button/action on WebUI matches Discord command behavior
- Seek bar: click to seek, verify playback jumps
- Queue drag-and-drop: reorder and verify queue reflects change in Discord
- Mobile: test responsive layout on phone viewport
- Auth: verify unauthorized users get 401, users not in guild get 403

### Database

- Run bot from fresh DB (no existing tables) — verify all tables auto-created
- Run bot with existing DB (pre-overhaul) — verify migration adds new tables without touching existing data
- Verify play history accumulates and paginated queries work correctly

### Edge Cases

- Bot not in voice → commands return friendly error
- Empty queue → `/nowplaying`, `/lyrics`, `/history` handle gracefully
- Track with no lyrics found → informative message
- WebSocket disconnect → client auto-reconnects and re-subscribes
- Multiple WebUI clients for same guild → all receive same broadcasts
- DJ role deleted from server → precondition degrades gracefully (treat as no restriction)

---

## Decisions

- **Svelte over React/Vue**: Smallest bundle size, fastest build, sufficient for a dashboard. No SSR needed.
- **`genius-lyrics` for lyrics**: Free, no API key, scrapes Genius. Alternative was `lyrics-finder` but less maintained.
- **Shared HTTP+WS port**: Avoids needing a second port. The `ws` server handles upgrade requests on the Sapphire HTTP server.
- **DJ role bypass when alone**: Prevents the DJ role from blocking a solo user — matches behavior of popular bots like Hydra/MEE6.
- **Cookie-based WebSocket auth**: Reuses Sapphire's encrypted auth cookie rather than implementing a separate token system.
- **`sirv` for static files**: 0-dependency, battle-tested static file server. Alternative was writing raw `fs.createReadStream` middleware.
- **History in SQLite**: Acceptable scale for per-guild history. If a guild plays 100 tracks/day, that's ~36K rows/year — well within SQLite's comfort zone.
