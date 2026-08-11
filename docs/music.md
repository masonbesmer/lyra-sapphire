# Feature Plan: A Fully-Featured Personal Discord Music Bot

## TL;DR
- Building a personal bot means you can offer, for free, every feature that popular bots gate behind premium — free volume control, audio filters, autoplay, 24/7 mode, unlimited playlists, and a web player — so the plan below catalogs the entire feature landscape from Groovy, Rythm, Hydra, Jockie Music, FredBoat, Green-bot, Uzox, Chip, FlaviBot, JMusicBot, Muse and others, then organizes it into six build phases.
- The must-have core that every serious bot shares is: play/pause/skip/seek/queue with slash commands plus interactive buttons, multi-source playback (YouTube, Spotify-resolved, SoundCloud, direct URLs, and user-uploaded attachments), loop/shuffle/queue management, and a now-playing embed with a progress bar; the differentiators you specifically asked about — autoplay/autofill, a web dashboard, uploaded-file playback, and a full filter suite — sit in later phases.
- Premium-gated features across the market that your bot can include free: volume control (Rythm, Hydra, Green-bot gate this), audio filters/effects, 24/7 stay-in-channel, autoplay/recommendations, unlimited saved playlists, extra bot instances, and web-player group listening — plus niche ideas worth stealing: SponsorBlock non-music skipping, Last.fm scrobbling, "guess the song" trivia, live synced karaoke lyrics, leave-cleanup, and Bandcamp buy-links.

## Key Findings

**The market has a clear "table-stakes" tier and a "differentiator" tier.** Every major bot — living or dead — implements the same playback and queue fundamentals. Groovy (installed on over 16 million servers before it was shut down August 30, 2021 following a YouTube cease-and-desist that cited "modifying the service and using it for commercial purposes," per KitGuru) and Rythm (active in over 20 million Discord servers spanning 560 million users before its September 15, 2021 shutdown, per reporting from The Verge/Digital Music News) established the baseline: play, pause, skip, queue, shuffle, loop, seek, lyrics, and search-with-selection. What separated bots commercially was almost always **volume control, audio filters, 24/7 mode, and autoplay** — features that were and are routinely paywalled. Because you are building for personal use, you can ship all of them free.

**Source breadth is the single biggest quality signal.** Jockie Music advertises the widest net (Spotify, Apple Music, Deezer, Tidal, SoundCloud, Bandcamp, Mixcloud, Vimeo, 20,000+ radio stations, direct HTTP, and Discord attachments). FredBoat covers SoundCloud, Bandcamp, Twitch, Vimeo, and Dailymotion. Spotify/Apple Music/Deezer/Tidal links are universally handled by resolving the track metadata and playing the audio from another source (typically YouTube) rather than streaming those services directly. Your explicit requirement — **playing user-uploaded attachments** — is supported by Jockie ("Discord attachments") and Muse/JMusicBot via direct file/URL handling.

**Autoplay means "keep the music going when the queue empties."** Hydra's autoplay "generate[s] a list of recommended songs based on just a few songs that you queued." Green-bot's autoplay "works by viewing your listening history and playing songs similar to what you've listened to." Jockie, Chip, and FlaviBot all expose an autoplay toggle. Radio/station modes (build an endless stream from a genre, artist, or seed) are a related feature seen in Euphony and Sonata.

**Filters are a well-defined, finite set.** Across Lavalink-based bots the standard catalog is: bassboost, nightcore, vaporwave, 8D (rotation), karaoke (vocal removal), tremolo, vibrato, timescale (speed/pitch/rate), lowpass, distortion, rotation, and a multi-band equalizer with presets plus custom EQ. Rythm's "effects studio" bundles presets (bassboost, nightcore) with manual bass/pitch/speed sliders.

**Web dashboards split into two kinds.** FlaviBot and the relaunched Rythm offer a true browser-based live player. Per AlternativeTo (June 2024), the 2024 Rythm relaunch as a Discord activity app has "a full user interface, allowing users to add songs, control music, view album art, and use a music visualizer." FlaviBot's official pages describe a live queue, search-and-add, drag-to-reorder, and skip/seek/volume from any browser. Hydra and Jockie instead offer settings/stats dashboards rather than live players, with in-Discord button/reaction players handling playback. Green-bot advertises a "web player to manage the music." Since you want a web UI, FlaviBot's live-player model is the target.

## Details

### 1. Playback basics (universal baseline)
Every surveyed bot implements these; ship them all in Phase 1.
- **play** — accept a search term or a URL; auto-join the requester's voice channel. Resume when paused and no argument is given (Rythm behavior).
- **pause / resume** — Rythm merges these (pause toggles resume).
- **skip** vs **forceskip** — Rythm's `/skip` is a **vote-skip requiring 50% of channel members** (auto-skips if you're alone); `/forceskip` is DJ-only and immediate. This vote-vs-force split with a configurable threshold (Jockie exposes "vote skip percentage") is the standard model.
- **stop / disconnect** — stop playback, clear queue, optionally leave.
- **seek** — jump to a timestamp; Rythm accepts `1:30`, `2m45s`, and "3 minutes 10 seconds" formats.
- **rewind / forward** — move playback backward/forward by a duration (Rythm `/rewind 30s`, `/forward 1m`).
- **replay / restart** — reset current track to the beginning.
- **previous track** — replay the last-played song (queue history dependent).
- **now playing** — embed with title, author, requester, duration, and a **progress bar**.
- **lyrics** — Groovy, Rythm, FredBoat all offered lyrics. JMusicBot pulls from configurable providers (A-Z Lyrics, Genius, MusicMatch, LyricsFreak). **Synced/live-scrolling lyrics** are a rarer premium-flavored feature (Euphony, Sonata, .fmbot lookups) — a strong differentiator.
- **volume** — Rythm supports 1–200. **This is premium-gated in Rythm, Hydra, and Green-bot** — make it free.
- **DJ role permissions** — JMusicBot's `setdj`, Rythm/Hydra `.setdj`; DJ-gated commands include skip, remove, clear, seek, volume, filters.

### 2. Queue management
- **view queue with pagination** (all bots), showing positions and durations.
- **add / remove / move / swap** — Rythm `/move <from> <to>`, `/remove <position>`.
- **shuffle** — randomize queue order.
- **loop modes** — track / queue / off. Hydra cycles these via one repeat button (press once = queue loop, twice = track loop, thrice = off).
- **clear queue** — remove all but the current track.
- **removedupes** — Rythm `/removedupes`, Green-bot "remove duplicate tracks" (premium in Green-bot).
- **leavecleanup** — Rythm `/leavecleanup` removes tracks queued by users who left the voice channel (premium in Green-bot). Niche but loved.
- **skipto <position>** — skip forward to a queue slot; with queue-loop on, skipped songs move to the end.
- **play next / playtop / priority insert** — Rythm `/playtop` and `/playskip`; FredBoat lets you set a track's priority to add it to the top.
- **queue history** — Rythm `/history` (personal and server-wide).
- **save / load queues** — Uzox "savedqueue" saves an entire server's queue to recall later; FlaviBot saved playlists follow you across servers.
- **queue length limits** — Jockie can set max/min track length and max queue behaviors; many bots cap free queue length (something you can leave unlimited).

### 3. Sources & search
- **YouTube** — videos, playlists, livestreams (Muse and FredBoat explicitly support livestreams).
- **Spotify** — tracks, playlists (Jockie caps at 100 tracks/playlist), albums, artists — resolved to a playable source.
- **SoundCloud, Bandcamp, Deezer, Apple Music, Tidal, Vimeo, Mixcloud** — Jockie's full set; FredBoat adds Twitch and Dailymotion.
- **Direct URL / HTTP streams** and **internet radio** — Jockie plays "20,000+ radio stations"; some bots cite 50,000.
- **Twitch streams** — Rythm and Jockie.
- **User-uploaded attachments** — Jockie "Discord attachments"; drag-and-drop a file and it plays. (Your explicit requirement.)
- **Search with selection menus** — FredBoat and Rythm show 5 results with dropdown/number selection; Rythm's `/search` has a "Queue All" button.
- **Platform-specific search prefixes** — JMusicBot exposes `ytsearch` and `scsearch` (SoundCloud) aliases.

### 4. Autoplay / autofill / recommendations
- **Autoplay** — when the queue empties, auto-queue related songs. Hydra bases it on the last few queued songs; Green-bot bases it on your listening history. Toggle on/off (Jockie `m!autoplay toggle`, FlaviBot `/autoplay`, Hydra `.autoplay`). **Premium-gated in Hydra and Green-bot** — make it free.
- **Radio/station modes** — seed an endless stream from a word, genre, artist, or station (Euphony custom-genre and artist radio; Sonata; FlaviBot radio).
- **Recommendation sources** — listening-history-based (Green-bot) or Spotify-recommendation-based autofill.
- **Auto-shuffle on load** — Hydra's `URL -a -s` instantly shuffles a loaded playlist.

### 5. Audio filters & effects
Ship the full Lavalink-standard set (all premium-gated somewhere in the market):
- **bassboost** (levels: none/low/medium/high in Jockie), **nightcore**, **vaporwave**, **8D** (rotation), **karaoke** (vocal removal), **tremolo**, **vibrato**, **distortion**, **lowpass**, **rotation**.
- **timescale** — independent **speed**, **pitch**, and **rate** control (FlaviBot exposes speed/pitch; Green-bot gates karaoke/speed/pitch behind premium).
- **equalizer** — genre presets (pop, soft, rock, classical, electronic, treblebass) plus **custom multi-band EQ** (Uzox `/equalizer`, Jockie's frequency-band control).
- **clearfilters / reset** — remove all effects at once.
- **fun extras** — "demon"/"earrape" (FlaviBot demon filter, Green-bot earrape).

### 6. Playlists & personalization
- **Saved custom playlists per user** — Hydra (premium unlimited), Green-bot (>5 requires premium), FlaviBot, Jockie custom collections (shareable).
- **Import Spotify/YouTube playlists** — Jockie `import`, Euphony import with optional ongoing sync.
- **Liked songs / favorites** — Rythm `/like` builds a personal liked-songs playlist synced to your profile; Hydra star-favorites.
- **Listening history** — Rythm `/history`, FlaviBot `/history`.
- **Per-user / per-server defaults** — Jockie sets defaults at server/self/session scope (default volume, autoplay, repeat, search type).

### 7. Web UI / dashboard (your explicit requirement)
Target the **live-player** model:
- **Remote queue control** — view the live queue and now-playing in real time (FlaviBot).
- **Search-and-add from the browser** (FlaviBot, Rythm relaunch, Green-bot).
- **Drag-to-reorder queue** — FlaviBot explicitly supports drag-and-drop reordering from the dashboard.
- **Real-time sync** — queue and playback state update live across browser and Discord.
- **Playback controls** — play/pause/skip/seek/volume/shuffle/loop from the browser.
- **Album art & visualizer** — Rythm's 2024 relaunch shows album art and a music visualizer (per AlternativeTo, June 2024: users can "add songs, control music, view album art, and use a music visualizer").
- **Saved playlists / favorites / history** in the dashboard.
- **Radio station browsing** (FlaviBot).
- **Server settings management** — prefix, DJ roles, language, announcement channel, allowed voice channels (Hydra, Jockie settings dashboards).
- **Stats** — Jockie shows usage statistics with access control (everyone/none).
- **Group listening** — per Rythm's 2024 launch announcement, premium subscribers ($4.99/month) can "host Sessions for up to 20 listeners," drawing on the "more-than 50m tracks that it has licensed" (you can offer group listening free).

### 8. Server / guild features
- **24/7 mode** — stay in the voice channel even when the queue empties (Hydra/Jockie/Green-bot/Uzox/Chip/FlaviBot). **Premium-gated in Hydra, Green-bot, Chip** — make it free.
- **Announcement channel** — post now-playing messages to a set channel; toggleable (FredBoat `config`, Hydra `.announce`, Rythm settings).
- **DJ roles & permission systems** — role-gated command sets.
- **Song-request channel** — Hydra's `.setup` creates a dedicated channel where bare song names (no prefix) are queued and a persistent button-player is shown; Green-bot and FlaviBot have the same "controller" concept.
- **Per-server prefix / slash commands** — customizable prefix; slash by default.
- **Voice channel status / stage channel support** — Green-bot and FlaviBot "support Stage Channels"; the bot can act as a stage speaker.
- **Multiple simultaneous voice connections per guild** — Jockie's signature feature: up to 4 bot instances free (23+ with premium) playing different music in different channels at once. Achievable in a personal bot by running multiple instances.
- **Auto-disconnect timers** — JMusicBot's `alonetimeuntilstop` leaves after being alone for N seconds.
- **Vote systems** — vote-skip with configurable threshold.
- **Restrict-to-voice-channel** — Hydra `.setvc`, FlaviBot `setvc`, JMusicBot restrictions.

### 9. Quality-of-life & extras (differentiators)
- **SponsorBlock-style skipping** — skip non-music segments of YouTube videos. Muse offers this via `ENABLE_SPONSORBLOCK`; JMusicBot added a `skipsegment` command using the SponsorBlock `music_offtopic` category; YADMB auto-skips sponsors. A strong, distinctive feature.
- **Song voting / likes** — Rythm `/like`.
- **Listening stats & charts** — .fmbot generates most-played artists/albums/tracks, image charts, "icebergs," and "receipts" from history; top-listeners leaderboards.
- **Last.fm scrobbling** — .fmbot reads bots' now-playing messages and scrobbles for everyone in the voice channel; Cordscrobbler does the same; Uzox can connect a Last.fm account. Building native scrobbling is a rare, high-value feature.
- **Text-in-voice controls** and **buttons/interactive controls** on now-playing embeds — Chip, FlaviBot `/buttons` toggle, Hydra reaction/button players.
- **DM notifications** — JMusicBot DMs the owner on new versions; notify requesters when their track starts.
- **Localization / multi-language** — Hydra `.language list`, FlaviBot, Green-bot (LavaMusic cites 15+ languages).
- **Audio quality options / normalization** — loudness leveling across tracks (aliana-client "audio normalization"); bitrate awareness.
- **Crossfade / gapless playback** — Euphony advertises smooth/gapless transitions.
- **Playback speed** — via timescale.
- **Guess-the-song trivia** — Jockie `m!guess the song` with scoring and leaderboards; standalone "Guess The Song" activity; a fun social extra.
- **Live synced karaoke lyrics** — Sonata's `/karaoke` suppresses vocals and scrolls synced lyrics line-by-line; Euphony synced lyrics.
- **Bandcamp buy-links** — Sonata puts a purchase link in the embed for Bandcamp tracks so artists get paid — a thoughtful niche touch.
- **Soundboard / short clips** — Discord's native soundboard (per Discord's developer docs, sounds have a maximum file size of 512 KiB and a maximum duration of 5.2 seconds; slot count scales by Boost level: 8 at Level 0, 24 at Level 1, 36 at Level 2, and 60 at Level 3 — 96 with the MORE_SOUNDBOARD feature) and ChipBot-style custom clip playback.

### 10. Discord platform capabilities to build on
- **Slash commands** (default across all modern bots) and **prefix commands** as an option.
- **Context menus** (right-click a message/user to act).
- **Buttons & select menus** — interactive now-playing controls and search selection.
- **Embedded activities / stage support** — Rythm relaunched as a Discord Activity with a full in-client UI; stage-channel speaker support.

## Recommendations

Build in six phases. Ship Phase 1–2 first as a usable MVP, then layer on the differentiators.

**Phase 1 — MVP core playback.** play (search + URL, auto-join), pause/resume, skip (vote) + forceskip, stop/disconnect, seek/rewind/forward, replay, now-playing embed with progress bar, basic queue view with pagination, slash commands + interactive buttons on the now-playing message. *Benchmark to advance: a user can queue and control YouTube audio end-to-end with buttons.*

**Phase 2 — Queue management & sources.** move/remove/swap, shuffle, loop (track/queue/off), clear, removedupes, leavecleanup, skipto, playtop/playnext, queue history/previous. Add sources: Spotify (track/playlist/album/artist resolution), SoundCloud, Bandcamp, Deezer, Apple Music, direct URLs, internet radio, and **user-uploaded attachments** (your priority). Search-with-selection menus and platform prefixes. *Benchmark: every source type resolves and an uploaded file plays.*

**Phase 3 — Autoplay & recommendations.** Autoplay toggle (queue-empty related-song fill) using both seed-based and listening-history strategies; radio/station seed mode (genre/artist/word); auto-shuffle on playlist load. *Benchmark: the bot never goes silent with autoplay on.*

**Phase 4 — Filters & audio quality.** Full filter suite (bassboost, nightcore, vaporwave, 8D, karaoke, tremolo, vibrato, distortion, lowpass, rotation), timescale (speed/pitch/rate), EQ presets + custom EQ, clearfilters; free volume 1–200; loudness normalization; crossfade/gapless. *Benchmark: filters apply in real time without restarting the track.*

**Phase 5 — Web UI & personalization.** Live web player: real-time queue, search-and-add, drag-to-reorder, play/pause/skip/seek/volume, album art, saved playlists/favorites/history, radio browsing, and server-settings management. Per-user playlists, Spotify/YouTube import, liked songs, per-server defaults. *Benchmark: the browser and Discord stay in sync bidirectionally.*

**Phase 6 — Polish & extras.** 24/7 mode, song-request channel with persistent controller, DJ roles, announcement channel, stage support, auto-disconnect timer, restrict-to-VC, localization. Differentiators: SponsorBlock non-music skipping, Last.fm scrobbling, listening stats/charts, synced karaoke lyrics, guess-the-song trivia, Bandcamp buy-links, DM notifications. Optionally, multiple simultaneous voice connections. *Benchmark: the bot matches or exceeds any single premium competitor.*

**What would change the plan:** If you mostly listen solo, deprioritize vote-skip, DJ roles, and group listening and pull the web player earlier. If YouTube reliability becomes a problem (the cause of Groovy's and the original Rythm's shutdowns), prioritize multi-source fallback resolution. If you want the social layer, move Last.fm scrobbling and stats up to Phase 4.

## Caveats
- **Legal/ToS risk is real.** Groovy (16M+ servers) and the original Rythm (20M+ servers, 560M users) were shut down in 2021 after YouTube/Google enforcement. Groovy founder Nik Ammerlaan told The Verge that "something like 98 percent of the tracks played on Groovy were from YouTube" — the practice YouTube cited as violating its ToS. A personal bot lowers your visibility but does not change the underlying terms; several bots resolve Spotify/Apple links through YouTube, which is the exact pattern that drew enforcement.
- **Source-availability numbers vary.** Radio-station counts range from Jockie's "20,000+" to others' "50,000"; treat as marketing figures.
- **Some feature attributions come from third-party guides and bot-list pages, not official docs.** Where a capability was only described by a listing site (e.g., certain Green-bot and Uzox dashboard specifics), it is noted as such; Hydra and Jockie web dashboards are settings/stats-oriented rather than live players despite broad "dashboard" marketing.
- **Synced-lyrics and scrobbling depend on external data sources** whose availability and licensing can change.
- **Filter naming is not standardized** across libraries; the same effect (e.g., 8D vs rotation) may appear under different names.