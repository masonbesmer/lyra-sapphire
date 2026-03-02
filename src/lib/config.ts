import { db } from './database';

export type TranscribeConfig = {
	guild_id: string;
	min_audio_seconds: number;
	interval_ms: number;
	chunk_s: number;
};

export function getTranscribeConfig(guildId: string): TranscribeConfig {
	const row = db.prepare('SELECT * FROM transcribe_config WHERE guild_id = ?').get(guildId);
	if (!row) {
		return {
			guild_id: guildId,
			min_audio_seconds: 0.5,
			interval_ms: 2000,
			chunk_s: 5
		};
	}
	return {
		guild_id: row.guild_id,
		min_audio_seconds: row.min_audio_seconds,
		interval_ms: row.interval_ms,
		chunk_s: row.chunk_s
	};
}

export function setTranscribeConfig(config: Partial<TranscribeConfig> & { guild_id: string }): void {
	const stmt = db.prepare(
		`INSERT INTO transcribe_config (guild_id, min_audio_seconds, interval_ms, chunk_s)
		VALUES (@guild_id, @min_audio_seconds, @interval_ms, @chunk_s)
		ON CONFLICT(guild_id) DO UPDATE SET
		min_audio_seconds=excluded.min_audio_seconds,
		interval_ms=excluded.interval_ms,
		chunk_s=excluded.chunk_s`
	);
	stmt.run({
		guild_id: config.guild_id,
		min_audio_seconds: config.min_audio_seconds ?? 0.5,
		interval_ms: config.interval_ms ?? 2000,
		chunk_s: config.chunk_s ?? 5
	});
}

export type MusicConfig = {
	guild_id: string;
	dj_role_id: string | null;
	default_volume: number;
	announce_tracks: boolean;
};

export function getMusicConfig(guildId: string): MusicConfig {
	const row = db.prepare('SELECT * FROM music_config WHERE guild_id = ?').get(guildId) as
		| { guild_id: string; dj_role_id: string | null; default_volume: number; announce_tracks: number }
		| undefined;
	if (!row) {
		return { guild_id: guildId, dj_role_id: null, default_volume: 25, announce_tracks: true };
	}
	return {
		guild_id: row.guild_id,
		dj_role_id: row.dj_role_id ?? null,
		default_volume: row.default_volume,
		announce_tracks: row.announce_tracks !== 0
	};
}

export function setMusicConfig(config: Partial<MusicConfig> & { guild_id: string }): void {
	const curr = getMusicConfig(config.guild_id);
	db.prepare(
		`INSERT INTO music_config (guild_id, dj_role_id, default_volume, announce_tracks)
		VALUES (@guild_id, @dj_role_id, @default_volume, @announce_tracks)
		ON CONFLICT(guild_id) DO UPDATE SET
		dj_role_id=excluded.dj_role_id,
		default_volume=excluded.default_volume,
		announce_tracks=excluded.announce_tracks`
	).run({
		guild_id: config.guild_id,
		dj_role_id: config.dj_role_id !== undefined ? config.dj_role_id : curr.dj_role_id,
		default_volume: config.default_volume ?? curr.default_volume,
		announce_tracks: (config.announce_tracks !== undefined ? config.announce_tracks : curr.announce_tracks) ? 1 : 0
	});
}
