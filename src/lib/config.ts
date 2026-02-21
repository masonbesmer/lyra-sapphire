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
