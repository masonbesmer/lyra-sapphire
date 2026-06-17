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
