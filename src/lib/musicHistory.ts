import { db } from './database';

export type PlayHistoryEntry = {
	guild_id: string;
	user_id: string;
	track_title: string;
	track_url: string;
	track_duration_ms?: number;
	source?: string | null;
	played_at?: string;
};

export type PlayHistoryRow = PlayHistoryEntry & { id: number; played_at: string; track_duration_ms: number };

export function addPlayHistory(entry: PlayHistoryEntry): void {
	db.prepare(
		`INSERT INTO play_history (guild_id, user_id, track_title, track_url, track_duration_ms, source, played_at)
		VALUES (@guild_id, @user_id, @track_title, @track_url, @track_duration_ms, @source, @played_at)`
	).run({
		guild_id: entry.guild_id,
		user_id: entry.user_id,
		track_title: entry.track_title,
		track_url: entry.track_url,
		track_duration_ms: entry.track_duration_ms ?? 0,
		source: entry.source ?? null,
		played_at: entry.played_at ?? new Date().toISOString()
	});
}

export function getPlayHistory(guildId: string, limit = 20, offset = 0): PlayHistoryRow[] {
	return db
		.prepare(`SELECT * FROM play_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT ? OFFSET ?`)
		.all(guildId, limit, offset) as PlayHistoryRow[];
}

export type TrackStat = { track_title: string; track_url: string; play_count: number };
export type UserStat = { user_id: string; play_count: number };

export function getTopTracks(guildId: string, limit = 10): TrackStat[] {
	return db
		.prepare(
			`SELECT track_title, track_url, COUNT(*) as play_count FROM play_history WHERE guild_id = ? GROUP BY track_url ORDER BY play_count DESC LIMIT ?`
		)
		.all(guildId, limit) as TrackStat[];
}

export function getTopUsers(guildId: string, limit = 5): UserStat[] {
	return db
		.prepare(`SELECT user_id, COUNT(*) as play_count FROM play_history WHERE guild_id = ? GROUP BY user_id ORDER BY play_count DESC LIMIT ?`)
		.all(guildId, limit) as UserStat[];
}
