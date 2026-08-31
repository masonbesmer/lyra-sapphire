import { db } from './database';

export type MusicConfig = {
	guild_id: string;
	dj_role_id: string | null;
	default_volume: number;
	announce_tracks: boolean;
	announce_channel_id: string | null;
};

export function getMusicConfig(guildId: string): MusicConfig {
	const row = db.prepare('SELECT * FROM music_config WHERE guild_id = ?').get(guildId) as
		| {
				guild_id: string;
				dj_role_id: string | null;
				default_volume: number;
				announce_tracks: number;
				announce_channel_id: string | null;
		  }
		| undefined;
	if (!row) {
		return { guild_id: guildId, dj_role_id: null, default_volume: 25, announce_tracks: true, announce_channel_id: null };
	}
	return {
		guild_id: row.guild_id,
		dj_role_id: row.dj_role_id ?? null,
		default_volume: row.default_volume,
		announce_tracks: row.announce_tracks !== 0,
		announce_channel_id: row.announce_channel_id ?? null
	};
}

export function setMusicConfig(config: Partial<MusicConfig> & { guild_id: string }): void {
	const curr = getMusicConfig(config.guild_id);
	db.prepare(
		`INSERT INTO music_config (guild_id, dj_role_id, default_volume, announce_tracks, announce_channel_id)
		VALUES (@guild_id, @dj_role_id, @default_volume, @announce_tracks, @announce_channel_id)
		ON CONFLICT(guild_id) DO UPDATE SET
		dj_role_id=excluded.dj_role_id,
		default_volume=excluded.default_volume,
		announce_tracks=excluded.announce_tracks,
		announce_channel_id=excluded.announce_channel_id`
	).run({
		guild_id: config.guild_id,
		dj_role_id: config.dj_role_id !== undefined ? config.dj_role_id : curr.dj_role_id,
		default_volume: config.default_volume ?? curr.default_volume,
		announce_tracks: (config.announce_tracks !== undefined ? config.announce_tracks : curr.announce_tracks) ? 1 : 0,
		announce_channel_id: config.announce_channel_id !== undefined ? config.announce_channel_id : curr.announce_channel_id
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
	/**
	 * Whether spoken word triggers are armed. Separate from `enabled` because it is a
	 * materially bigger ask: the wake word means one phrase is matched on-device and nothing
	 * else leaves the process, while this transcribes every utterance in the channel.
	 */
	triggers_enabled: boolean;
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
				triggers_enabled: number | null;
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
			max_utterance_ms: 8000,
			triggers_enabled: false
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
		max_utterance_ms: row.max_utterance_ms,
		// Nullable, not just falsy: rows written before the column existed have NULL here.
		triggers_enabled: Boolean(row.triggers_enabled)
	};
}

export function setVoiceAssistantConfig(config: Partial<VoiceAssistantConfig> & { guild_id: string }): void {
	const curr = getVoiceAssistantConfig(config.guild_id);
	db.prepare(
		`INSERT INTO voice_assistant_config (guild_id, enabled, wake_word, sensitivity, require_dj, ack_mode, text_channel_id, silence_ms, max_utterance_ms, triggers_enabled)
		VALUES (@guild_id, @enabled, @wake_word, @sensitivity, @require_dj, @ack_mode, @text_channel_id, @silence_ms, @max_utterance_ms, @triggers_enabled)
		ON CONFLICT(guild_id) DO UPDATE SET
		enabled=excluded.enabled,
		wake_word=excluded.wake_word,
		sensitivity=excluded.sensitivity,
		require_dj=excluded.require_dj,
		ack_mode=excluded.ack_mode,
		text_channel_id=excluded.text_channel_id,
		silence_ms=excluded.silence_ms,
		max_utterance_ms=excluded.max_utterance_ms,
		triggers_enabled=excluded.triggers_enabled`
	).run({
		guild_id: config.guild_id,
		enabled: (config.enabled !== undefined ? config.enabled : curr.enabled) ? 1 : 0,
		wake_word: config.wake_word ?? curr.wake_word,
		sensitivity: config.sensitivity ?? curr.sensitivity,
		require_dj: (config.require_dj !== undefined ? config.require_dj : curr.require_dj) ? 1 : 0,
		ack_mode: config.ack_mode ?? curr.ack_mode,
		text_channel_id: config.text_channel_id !== undefined ? config.text_channel_id : curr.text_channel_id,
		silence_ms: config.silence_ms ?? curr.silence_ms,
		max_utterance_ms: config.max_utterance_ms ?? curr.max_utterance_ms,
		triggers_enabled: (config.triggers_enabled !== undefined ? config.triggers_enabled : curr.triggers_enabled) ? 1 : 0
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

// ── Command role requirements ───────────────────────────────────────────────

export type CommandPermission = { command_name: string; required_role_id: string };

export function getCommandPermissions(guildId: string): CommandPermission[] {
	return db
		.prepare('SELECT command_name, required_role_id FROM command_permissions WHERE guild_id = ? ORDER BY command_name')
		.all(guildId) as CommandPermission[];
}

export function setCommandPermission(guildId: string, commandName: string, roleId: string): void {
	db.prepare('INSERT OR REPLACE INTO command_permissions (guild_id, command_name, required_role_id) VALUES (?, ?, ?)').run(
		guildId,
		commandName.toLowerCase(),
		roleId
	);
}

export function deleteCommandPermission(guildId: string, commandName: string): boolean {
	return db.prepare('DELETE FROM command_permissions WHERE guild_id = ? AND command_name = ?').run(guildId, commandName.toLowerCase()).changes > 0;
}

// ── Word triggers ───────────────────────────────────────────────────────────
// Guild-scoped: the table is keyed by (guild_id, keyword), so a trigger only
// fires and is only visible in the server it was added in.

export type WordTrigger = { keyword: string; response: string };

export function getWordTriggers(guildId: string): WordTrigger[] {
	return db.prepare('SELECT keyword, response FROM word_triggers WHERE guild_id = ? ORDER BY keyword').all(guildId) as WordTrigger[];
}

export function setWordTrigger(guildId: string, keyword: string, response: string): void {
	db.prepare('INSERT OR REPLACE INTO word_triggers (guild_id, keyword, response) VALUES (?, ?, ?)').run(guildId, keyword.toLowerCase(), response);
}

export function deleteWordTrigger(guildId: string, keyword: string): boolean {
	return db.prepare('DELETE FROM word_triggers WHERE guild_id = ? AND keyword = ?').run(guildId, keyword.toLowerCase()).changes > 0;
}

// ── Voice word triggers ─────────────────────────────────────────────────────
// The spoken counterpart of the list above, kept in its own table: voice listening
// transcribes everything said in the channel, so what is allowed to fire there is worth
// curating separately from what fires in chat.

export type VoiceTriggerResponseType = 'text' | 'sound' | 'speak';

export type VoiceWordTrigger = {
	keyword: string;
	response_type: VoiceTriggerResponseType;
	/** Reply text for a 'text' trigger, or the stored sound's name for a 'sound' one. */
	response: string;
	cooldown_ms: number;
};

export function getVoiceWordTriggers(guildId: string): VoiceWordTrigger[] {
	return db
		.prepare('SELECT keyword, response_type, response, cooldown_ms FROM voice_word_triggers WHERE guild_id = ? ORDER BY keyword')
		.all(guildId) as VoiceWordTrigger[];
}

export function setVoiceWordTrigger(guildId: string, trigger: VoiceWordTrigger): void {
	db.prepare(
		`INSERT OR REPLACE INTO voice_word_triggers (guild_id, keyword, response_type, response, cooldown_ms)
		VALUES (?, ?, ?, ?, ?)`
	).run(guildId, trigger.keyword.toLowerCase(), trigger.response_type, trigger.response, trigger.cooldown_ms);
}

export function deleteVoiceWordTrigger(guildId: string, keyword: string): boolean {
	return db.prepare('DELETE FROM voice_word_triggers WHERE guild_id = ? AND keyword = ?').run(guildId, keyword.toLowerCase()).changes > 0;
}

/** Every trigger pointing at a given sound, so deleting the file can report what it would break. */
export function getVoiceTriggersUsingSound(guildId: string, sound: string): VoiceWordTrigger[] {
	return db
		.prepare(
			`SELECT keyword, response_type, response, cooldown_ms FROM voice_word_triggers WHERE guild_id = ? AND response_type = 'sound' AND response = ?`
		)
		.all(guildId, sound) as VoiceWordTrigger[];
}

/**
 * Records that a spoken trigger fired.
 *
 * Only the keyword is stored, never the surrounding utterance. The wake-word path logs full
 * transcripts because there the user addressed the bot deliberately; trigger scanning sees
 * ordinary conversation, and writing that to disk is not something anyone opted into.
 */
export function logVoiceTrigger(entry: { guildId: string; userId: string; keyword: string; dispatched: boolean }): void {
	db.prepare(
		`INSERT INTO voice_command_log (guild_id, user_id, transcript, intent, confidence, dispatched, created_at)
		VALUES (?, ?, ?, 'voice_trigger', NULL, ?, ?)`
	).run(entry.guildId, entry.userId, entry.keyword, entry.dispatched ? 1 : 0, new Date().toISOString());
}
