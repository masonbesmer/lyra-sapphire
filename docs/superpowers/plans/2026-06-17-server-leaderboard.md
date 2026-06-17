# Server Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-guild leaderboard tracking message count and voice time per user, accessible via `/leaderboard` slash command and `GET /api/guilds/:guild/leaderboard`.

**Architecture:** Event-sourced SQLite tables (`leaderboard_messages`, `leaderboard_voice`) record raw events; queries aggregate at read time, enabling time-window filtering (all-time / weekly / monthly). A shared library (`src/lib/leaderboard.ts`) exports the in-memory voice session map and both query functions, consumed by both the slash command and the API route.

**Tech Stack:** TypeScript, Sapphire Framework v5, better-sqlite3, discord.js v14

---

> **No test framework exists in this project.** TDD steps are replaced with TypeScript build verification (`yarn build:bot`) and manual smoke-test instructions.

---

## File Map

| File                                               | Status | Responsibility                                   |
| -------------------------------------------------- | ------ | ------------------------------------------------ |
| `src/lib/database.ts`                              | Modify | Add 2 tables + 2 indexes                         |
| `src/lib/leaderboard.ts`                           | Create | Voice session map, query functions, type exports |
| `src/listeners/leaderboardMessage.ts`              | Create | `messageCreate` → insert row                     |
| `src/listeners/leaderboardVoice.ts`                | Create | `voiceStateUpdate` → track sessions              |
| `src/commands/General/leaderboard.ts`              | Create | `/leaderboard` slash command                     |
| `src/routes/api/guilds/[guild]/leaderboard.get.ts` | Create | REST endpoint                                    |

---

## Task 1: Database Tables

**Files:**

- Modify: `src/lib/database.ts`

- [ ] **Step 1: Add tables and indexes**

Open `src/lib/database.ts` and append after the last `db.exec(...)` call (after the `active_sessions` block at line 122):

```typescript
db.exec(
	`CREATE TABLE IF NOT EXISTS leaderboard_messages (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		user_id     TEXT NOT NULL,
		recorded_at TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_lb_messages_guild_time ON leaderboard_messages (guild_id, recorded_at DESC)`);

db.exec(
	`CREATE TABLE IF NOT EXISTS leaderboard_voice (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		user_id     TEXT NOT NULL,
		duration_s  INTEGER NOT NULL,
		recorded_at TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_lb_voice_guild_time ON leaderboard_voice (guild_id, recorded_at DESC)`);
```

- [ ] **Step 2: Verify build**

```bash
yarn build:bot
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/database.ts
git commit -m "feat(leaderboard): add leaderboard_messages and leaderboard_voice tables"
```

---

## Task 2: Leaderboard Library

**Files:**

- Create: `src/lib/leaderboard.ts`

- [ ] **Step 1: Create the library file**

Create `src/lib/leaderboard.ts`:

```typescript
import { db } from './database';

export interface LeaderboardEntry {
	userId: string;
	value: number;
}

type Period = 'all' | 'weekly' | 'monthly';

export const voiceSessions = new Map<string, number>();

function periodFilter(period: Period): string {
	if (period === 'weekly') return `-7 days`;
	if (period === 'monthly') return `-30 days`;
	return '';
}

export function getMessageLeaderboard(guildId: string, period: Period): LeaderboardEntry[] {
	const filter = periodFilter(period);
	const rows =
		filter === ''
			? (db
					.prepare(
						`SELECT user_id, COUNT(*) as value
					FROM leaderboard_messages
					WHERE guild_id = ?
					GROUP BY user_id
					ORDER BY value DESC
					LIMIT 5`
					)
					.all(guildId) as { user_id: string; value: number }[])
			: (db
					.prepare(
						`SELECT user_id, COUNT(*) as value
					FROM leaderboard_messages
					WHERE guild_id = ? AND recorded_at >= datetime('now', ?)
					GROUP BY user_id
					ORDER BY value DESC
					LIMIT 5`
					)
					.all(guildId, filter) as { user_id: string; value: number }[]);

	return rows.map((r) => ({ userId: r.user_id, value: r.value }));
}

export function getVoiceLeaderboard(guildId: string, period: Period): LeaderboardEntry[] {
	const filter = periodFilter(period);
	const rows =
		filter === ''
			? (db
					.prepare(
						`SELECT user_id, SUM(duration_s) as value
					FROM leaderboard_voice
					WHERE guild_id = ?
					GROUP BY user_id
					ORDER BY value DESC
					LIMIT 5`
					)
					.all(guildId) as { user_id: string; value: number }[])
			: (db
					.prepare(
						`SELECT user_id, SUM(duration_s) as value
					FROM leaderboard_voice
					WHERE guild_id = ? AND recorded_at >= datetime('now', ?)
					GROUP BY user_id
					ORDER BY value DESC
					LIMIT 5`
					)
					.all(guildId, filter) as { user_id: string; value: number }[]);

	return rows.map((r) => ({ userId: r.user_id, value: r.value }));
}

export function recordMessage(guildId: string, userId: string): void {
	db.prepare(`INSERT INTO leaderboard_messages (guild_id, user_id, recorded_at) VALUES (?, ?, datetime('now'))`).run(guildId, userId);
}

export function recordVoiceSession(guildId: string, userId: string, durationS: number): void {
	db.prepare(`INSERT INTO leaderboard_voice (guild_id, user_id, duration_s, recorded_at) VALUES (?, ?, ?, datetime('now'))`).run(
		guildId,
		userId,
		durationS
	);
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build:bot
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/leaderboard.ts
git commit -m "feat(leaderboard): add leaderboard library with query functions"
```

---

## Task 3: Message Listener

**Files:**

- Create: `src/listeners/leaderboardMessage.ts`

- [ ] **Step 1: Create the listener**

Create `src/listeners/leaderboardMessage.ts`:

```typescript
import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { recordMessage } from '../lib/leaderboard';

@ApplyOptions<Listener.Options>({
	event: Events.MessageCreate
})
export class LeaderboardMessageListener extends Listener<typeof Events.MessageCreate> {
	public override run(message: Message): void {
		if (message.author.bot) return;
		if (!message.guild) return;
		if (message.system) return;
		recordMessage(message.guild.id, message.author.id);
	}
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build:bot
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/listeners/leaderboardMessage.ts
git commit -m "feat(leaderboard): track messages via messageCreate listener"
```

---

## Task 4: Voice Listener

**Files:**

- Create: `src/listeners/leaderboardVoice.ts`

- [ ] **Step 1: Create the listener**

Create `src/listeners/leaderboardVoice.ts`:

```typescript
import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { voiceSessions, recordVoiceSession } from '../lib/leaderboard';

@ApplyOptions<Listener.Options>({
	event: Events.VoiceStateUpdate
})
export class LeaderboardVoiceListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override run(oldState: VoiceState, newState: VoiceState): void {
		const member = newState.member ?? oldState.member;
		if (!member || member.user.bot) return;

		const guildId = newState.guild.id;
		const userId = member.id;
		const key = `${userId}:${guildId}`;
		const now = Date.now();

		const joined = oldState.channelId === null && newState.channelId !== null;
		const left = oldState.channelId !== null && newState.channelId === null;
		const switched = oldState.channelId !== null && newState.channelId !== null && oldState.channelId !== newState.channelId;

		if (joined) {
			voiceSessions.set(key, now);
			return;
		}

		if (left || switched) {
			const joinTime = voiceSessions.get(key);
			if (joinTime !== undefined) {
				const durationS = Math.floor((now - joinTime) / 1000);
				if (durationS > 0) recordVoiceSession(guildId, userId, durationS);
				voiceSessions.delete(key);
			}
			if (switched) {
				voiceSessions.set(key, now);
			}
		}
	}
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build:bot
```

Expected: no errors.

- [ ] **Step 3: Smoke test voice tracking**

Start the bot in dev mode (`yarn dev`), join a voice channel, wait 30 seconds, then leave. Query the database:

```bash
sqlite3 data/word_triggers.db "SELECT * FROM leaderboard_voice LIMIT 5;"
```

Expected: one row with `duration_s` ~30.

- [ ] **Step 4: Commit**

```bash
git add src/listeners/leaderboardVoice.ts
git commit -m "feat(leaderboard): track voice sessions via voiceStateUpdate listener"
```

---

## Task 5: Slash Command

**Files:**

- Create: `src/commands/General/leaderboard.ts`

- [ ] **Step 1: Create the command**

Create `src/commands/General/leaderboard.ts`:

```typescript
import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';
import { getMessageLeaderboard, getVoiceLeaderboard } from '../../lib/leaderboard';

function formatVoice(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

@ApplyOptions<Command.Options>({
	description: 'View the server leaderboard'
})
export class LeaderboardCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((opt) =>
					opt
						.setName('stat')
						.setDescription('Which stat to rank by')
						.setRequired(true)
						.addChoices({ name: 'Messages', value: 'messages' }, { name: 'Voice Time', value: 'voice' })
				)
				.addStringOption((opt) =>
					opt
						.setName('period')
						.setDescription('Time window (default: all-time)')
						.setRequired(false)
						.addChoices({ name: 'All Time', value: 'all' }, { name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' })
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guild) {
			return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
		}

		const stat = interaction.options.getString('stat', true) as 'messages' | 'voice';
		const period = (interaction.options.getString('period') ?? 'all') as 'all' | 'weekly' | 'monthly';

		const entries = stat === 'messages' ? getMessageLeaderboard(interaction.guild.id, period) : getVoiceLeaderboard(interaction.guild.id, period);

		const periodLabel = period === 'all' ? 'All Time' : period === 'weekly' ? 'This Week' : 'This Month';
		const statLabel = stat === 'messages' ? 'Messages' : 'Voice Time';

		if (entries.length === 0) {
			return interaction.reply({ content: `No ${statLabel.toLowerCase()} data yet for this server.`, ephemeral: true });
		}

		const lines = await Promise.all(
			entries.map(async (entry, i) => {
				let name: string;
				try {
					const member = await interaction.guild!.members.fetch(entry.userId);
					name = member.displayName;
				} catch {
					name = `<@${entry.userId}>`;
				}
				const valueStr = stat === 'voice' ? formatVoice(entry.value) : entry.value.toLocaleString() + ' messages';
				return `**#${i + 1}** ${name} — ${valueStr}`;
			})
		);

		const embed = new EmbedBuilder()
			.setTitle(`🏆 ${statLabel} Leaderboard — ${periodLabel}`)
			.setDescription(lines.join('\n'))
			.setColor(stat === 'voice' ? '#5865F2' : '#57F287')
			.setFooter({ text: interaction.guild.name })
			.setTimestamp();

		return interaction.reply({ embeds: [embed] });
	}
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build:bot
```

Expected: no errors.

- [ ] **Step 3: Smoke test command**

Start the bot (`yarn dev`), run `/leaderboard stat:Messages period:All Time` in a server. Expected: embed with top 5 (or "No data yet" if fresh install).

- [ ] **Step 4: Commit**

```bash
git add src/commands/General/leaderboard.ts
git commit -m "feat(leaderboard): add /leaderboard slash command"
```

---

## Task 6: API Route

**Files:**

- Create: `src/routes/api/guilds/[guild]/leaderboard.get.ts`

- [ ] **Step 1: Create the route**

Create `src/routes/api/guilds/[guild]/leaderboard.get.ts`:

```typescript
import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { getMessageLeaderboard, getVoiceLeaderboard } from '../../../../lib/leaderboard';

export class LeaderboardRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/leaderboard' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const query = request.query as Record<string, string>;
		const stat = query.stat;
		const period = (query.period ?? 'all') as 'all' | 'weekly' | 'monthly';

		if (stat !== 'messages' && stat !== 'voice') {
			response.error(HttpCodes.BadRequest);
			return;
		}

		if (period !== 'all' && period !== 'weekly' && period !== 'monthly') {
			response.error(HttpCodes.BadRequest);
			return;
		}

		const entries = stat === 'messages' ? getMessageLeaderboard(guildId, period) : getVoiceLeaderboard(guildId, period);

		const result = await Promise.all(
			entries.map(async (entry) => {
				let username: string;
				try {
					const member = await guild.members.fetch(entry.userId);
					username = member.displayName;
				} catch {
					username = entry.userId;
				}
				return { userId: entry.userId, username, value: entry.value };
			})
		);

		return response.json(result);
	}
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build:bot
```

Expected: no errors.

- [ ] **Step 3: Smoke test API**

Start the bot (`yarn dev`). With a valid session cookie, run:

```bash
curl "http://localhost:4000/api/guilds/<YOUR_GUILD_ID>/leaderboard?stat=messages&period=all" \
  -H "Cookie: lyra_session=<session_cookie>"
```

Expected: JSON array of `{ userId, username, value }` objects (or empty array if no data).

Test invalid param:

```bash
curl "http://localhost:4000/api/guilds/<YOUR_GUILD_ID>/leaderboard?stat=invalid" \
  -H "Cookie: lyra_session=<session_cookie>"
```

Expected: 400 response.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/guilds/[guild]/leaderboard.get.ts
git commit -m "feat(leaderboard): add GET /api/guilds/:guild/leaderboard route"
```
