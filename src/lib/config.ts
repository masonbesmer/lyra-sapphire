import { db } from './database';

export type MusicConfig = {
	guild_id: string;
	dj_role_id: string | null;
	default_volume: number;
	announce_tracks: boolean;
};

export function getMusicConfig(guildId: string): MusicConfig {
	const row = db.prepare('SELECT * FROM music_config WHERE guild_id = ?').get(guildId) as
		{ guild_id: string; dj_role_id: string | null; default_volume: number; announce_tracks: number } | undefined;
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

export type VoiceAssistantConfig = {
	guild_id: string;
	enabled: boolean;
	wake_word: string;
	sensitivity: number;
	require_dj: boolean;
	ack_mode: 'text' | 'none' | 'tts';
	text_channel_id: string | null;
	silence_ms: number;
	max_utterance_ms: number;
};

/** Defaults mirror the table's, so a guild with no row behaves as opt-out. */
export function getVoiceAssistantConfig(guildId: string): VoiceAssistantConfig {
	const row = db.prepare('SELECT * FROM voice_assistant_config WHERE guild_id = ?').get(guildId) as
		| {
				guild_id: string;
				enabled: number;
				wake_word: string;
				sensitivity: number;
				require_dj: number;
				ack_mode: string;
				text_channel_id: string | null;
				silence_ms: number;
				max_utterance_ms: number;
		  }
		| undefined;
	if (!row) {
		return {
			guild_id: guildId,
			enabled: false,
			wake_word: 'hey_jarvis_v0.1',
			sensitivity: 0.5,
			require_dj: true,
			ack_mode: 'text',
			text_channel_id: null,
			silence_ms: 600,
			max_utterance_ms: 8000
		};
	}
	return {
		guild_id: row.guild_id,
		enabled: row.enabled !== 0,
		wake_word: row.wake_word,
		sensitivity: row.sensitivity,
		require_dj: row.require_dj !== 0,
		ack_mode: (row.ack_mode as VoiceAssistantConfig['ack_mode']) ?? 'text',
		text_channel_id: row.text_channel_id ?? null,
		silence_ms: row.silence_ms,
		max_utterance_ms: row.max_utterance_ms
	};
}

export function setVoiceAssistantConfig(config: Partial<VoiceAssistantConfig> & { guild_id: string }): void {
	const curr = getVoiceAssistantConfig(config.guild_id);
	db.prepare(
		`INSERT INTO voice_assistant_config (guild_id, enabled, wake_word, sensitivity, require_dj, ack_mode, text_channel_id, silence_ms, max_utterance_ms)
		VALUES (@guild_id, @enabled, @wake_word, @sensitivity, @require_dj, @ack_mode, @text_channel_id, @silence_ms, @max_utterance_ms)
		ON CONFLICT(guild_id) DO UPDATE SET
		enabled=excluded.enabled,
		wake_word=excluded.wake_word,
		sensitivity=excluded.sensitivity,
		require_dj=excluded.require_dj,
		ack_mode=excluded.ack_mode,
		text_channel_id=excluded.text_channel_id,
		silence_ms=excluded.silence_ms,
		max_utterance_ms=excluded.max_utterance_ms`
	).run({
		guild_id: config.guild_id,
		enabled: (config.enabled !== undefined ? config.enabled : curr.enabled) ? 1 : 0,
		wake_word: config.wake_word ?? curr.wake_word,
		sensitivity: config.sensitivity ?? curr.sensitivity,
		require_dj: (config.require_dj !== undefined ? config.require_dj : curr.require_dj) ? 1 : 0,
		ack_mode: config.ack_mode ?? curr.ack_mode,
		text_channel_id: config.text_channel_id !== undefined ? config.text_channel_id : curr.text_channel_id,
		silence_ms: config.silence_ms ?? curr.silence_ms,
		max_utterance_ms: config.max_utterance_ms ?? curr.max_utterance_ms
	});
}

/**
 * Opt-out is checked before subscribing, never after — an opted-out user's stream must never
 * be opened, not merely ignored downstream.
 */
export function isVoiceOptedOut(guildId: string, userId: string): boolean {
	return db.prepare('SELECT 1 FROM voice_assistant_optout WHERE guild_id = ? AND user_id = ?').get(guildId, userId) !== undefined;
}

export function setVoiceOptOut(guildId: string, userId: string, optedOut: boolean): void {
	if (optedOut) {
		db.prepare('INSERT OR IGNORE INTO voice_assistant_optout (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
	} else {
		db.prepare('DELETE FROM voice_assistant_optout WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
	}
}

/** Transcripts only, never audio. Exists to tune the intent grammar. */
export function logVoiceCommand(entry: {
	guildId: string;
	userId: string;
	transcript: string;
	intent?: string | null;
	confidence?: number | null;
	dispatched?: boolean;
}): void {
	db.prepare(
		`INSERT INTO voice_command_log (guild_id, user_id, transcript, intent, confidence, dispatched, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(
		entry.guildId,
		entry.userId,
		entry.transcript,
		entry.intent ?? null,
		entry.confidence ?? null,
		entry.dispatched ? 1 : 0,
		new Date().toISOString()
	);
}
