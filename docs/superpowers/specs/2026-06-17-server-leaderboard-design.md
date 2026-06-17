# Server Leaderboard Design

**Date:** 2026-06-17  
**Status:** Approved

## Overview

Per-guild leaderboard tracking message count and voice time per user. Accessible via slash command and REST API. Time-window filtering (all-time, weekly, monthly) supported via event-sourced SQLite tables.

## Database Schema

Two new tables added to `src/lib/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS leaderboard_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    recorded_at TEXT NOT NULL  -- ISO8601 UTC
);
CREATE INDEX IF NOT EXISTS idx_lb_messages_guild_time
    ON leaderboard_messages (guild_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_voice (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    duration_s  INTEGER NOT NULL,  -- seconds spent in voice
    recorded_at TEXT NOT NULL      -- session end time, ISO8601 UTC
);
CREATE INDEX IF NOT EXISTS idx_lb_voice_guild_time
    ON leaderboard_voice (guild_id, recorded_at DESC);
```

Event-sourced design enables time-window filtering at query time. Mirrors the existing `play_history` table pattern.

## Event Listeners

### `src/listeners/leaderboardMessage.ts`

- Event: `messageCreate`
- Skips bots, DMs, system messages
- Inserts one row into `leaderboard_messages` per qualifying message

### `src/listeners/leaderboardVoice.ts`

- Event: `voiceStateUpdate`
- Tracks in-progress sessions via a module-level `Map<"userId:guildId", number>` (join timestamp in ms) exported from `src/lib/leaderboard.ts`
- **Join:** user enters a non-bot voice channel → set map entry
- **Leave/disconnect:** compute `duration_s = Math.floor((now - joinTime) / 1000)`, insert into `leaderboard_voice`, delete map entry
- **Channel switch:** update map entry timestamp (log only completed sessions)
- **Mute/deafen:** no-op — only join/leave channel membership matters
- Bots excluded

## Library — `src/lib/leaderboard.ts`

Exports:

- `voiceSessions: Map<string, number>` — in-memory join timestamp map
- `getMessageLeaderboard(guildId: string, period: 'all' | 'weekly' | 'monthly'): LeaderboardEntry[]`
- `getVoiceLeaderboard(guildId: string, period: 'all' | 'weekly' | 'monthly'): LeaderboardEntry[]`

```ts
interface LeaderboardEntry {
	userId: string;
	value: number; // message count or total voice seconds
}
```

Period filtering uses SQL `WHERE recorded_at >= datetime('now', '-7 days')` (weekly) or `-30 days` (monthly). Queries return top 5 rows ordered by value descending.

## Slash Command

**File:** `src/commands/General/leaderboard.ts`  
**Command:** `/leaderboard`

Options:
| Option | Type | Required | Choices |
|--------|------|----------|---------|
| `stat` | string | yes | `messages`, `voice` |
| `period` | string | no | `all` (default), `weekly`, `monthly` |

Output: Discord embed, top 5 users ranked. Format:

- Voice: `#1  @username — 4h 32m`
- Messages: `#1  @username — 1,204 messages`

Username resolved via `guild.members.fetch(userId)` with fallback to raw ID if member left.

## API Endpoint

**File:** `src/routes/api/guilds/[guild]/leaderboard.get.ts`

```
GET /api/guilds/:guildId/leaderboard?stat=messages|voice&period=all|weekly|monthly
```

Response:

```json
[
  { "userId": "123", "username": "exampleUser", "value": 1204 },
  ...
]
```

- Reuses `getMessageLeaderboard` / `getVoiceLeaderboard` from `src/lib/leaderboard.ts`
- Auth: same session cookie pattern as existing guild routes (`src/routes/api/guilds/_helpers.ts`)
- 400 on missing/invalid `stat` param
- 401 if unauthenticated

## Files Touched

| File                                               | Change                                    |
| -------------------------------------------------- | ----------------------------------------- |
| `src/lib/database.ts`                              | Add 2 tables + indexes                    |
| `src/lib/leaderboard.ts`                           | New — voice session map + query functions |
| `src/listeners/leaderboardMessage.ts`              | New — message event listener              |
| `src/listeners/leaderboardVoice.ts`                | New — voice state listener                |
| `src/commands/General/leaderboard.ts`              | New — slash command                       |
| `src/routes/api/guilds/[guild]/leaderboard.get.ts` | New — API route                           |
