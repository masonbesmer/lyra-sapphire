import { db } from './database';

/** Five minutes. Long enough to queue the next thing, short enough not to squat in a channel. */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export type MusicConfig = {
	guild_id: string;
	dj_role_id: string | null;
	default_volume: number;
	announce_tracks: boolean;
	announce_channel_id: string | null;
	/** How long after playback ends the music bot stays in voice. 0 keeps it there. */
	idle_timeout_ms: number;
};

export function getMusicConfig(guildId: string): MusicConfig {
	const row = db.prepare('SELECT * FROM music_config WHERE guild_id = ?').get(guildId) as
		| {
				guild_id: string;
				dj_role_id: string | null;
				default_volume: number;
				announce_tracks: number;
				announce_channel_id: string | null;
				idle_timeout_ms: number | null;
		  }
		| undefined;
	if (!row) {
		return {
			guild_id: guildId,
			dj_role_id: null,
			default_volume: 25,
			announce_tracks: true,
			announce_channel_id: null,
			idle_timeout_ms: DEFAULT_IDLE_TIMEOUT_MS
		};
	}
	return {
		guild_id: row.guild_id,
		dj_role_id: row.dj_role_id ?? null,
		default_volume: row.default_volume,
		announce_tracks: row.announce_tracks !== 0,
		announce_channel_id: row.announce_channel_id ?? null,
		// The column was added by migration, so rows written before it exists read back null.
		idle_timeout_ms: row.idle_timeout_ms ?? DEFAULT_IDLE_TIMEOUT_MS
	};
}

export function setMusicConfig(config: Partial<MusicConfig> & { guild_id: string }): void {
	const curr = getMusicConfig(config.guild_id);
	db.prepare(
		`INSERT INTO music_config (guild_id, dj_role_id, default_volume, announce_tracks, announce_channel_id, idle_timeout_ms)
		VALUES (@guild_id, @dj_role_id, @default_volume, @announce_tracks, @announce_channel_id, @idle_timeout_ms)
		ON CONFLICT(guild_id) DO UPDATE SET
		dj_role_id=excluded.dj_role_id,
		default_volume=excluded.default_volume,
		announce_tracks=excluded.announce_tracks,
		announce_channel_id=excluded.announce_channel_id,
		idle_timeout_ms=excluded.idle_timeout_ms`
	).run({
		guild_id: config.guild_id,
		dj_role_id: config.dj_role_id !== undefined ? config.dj_role_id : curr.dj_role_id,
		default_volume: config.default_volume ?? curr.default_volume,
		announce_tracks: (config.announce_tracks !== undefined ? config.announce_tracks : curr.announce_tracks) ? 1 : 0,
		announce_channel_id: config.announce_channel_id !== undefined ? config.announce_channel_id : curr.announce_channel_id,
		idle_timeout_ms: config.idle_timeout_ms ?? curr.idle_timeout_ms
	});
}

/** The delay the feature was specified with. */
export const DEFAULT_FOLLOW_DELAY_MS = 10_000;

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
	/** How long after a follower joins a voice channel Lyra follows them in. */
	follow_delay_ms: number;
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
				follow_delay_ms: number | null;
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
			follow_delay_ms: DEFAULT_FOLLOW_DELAY_MS
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
		// Added by migration, so pre-existing rows read back null.
		follow_delay_ms: row.follow_delay_ms ?? DEFAULT_FOLLOW_DELAY_MS
	};
}

export function setVoiceAssistantConfig(config: Partial<VoiceAssistantConfig> & { guild_id: string }): void {
	const curr = getVoiceAssistantConfig(config.guild_id);
	db.prepare(
		`INSERT INTO voice_assistant_config (guild_id, enabled, wake_word, sensitivity, require_dj, ack_mode, text_channel_id, silence_ms, max_utterance_ms, follow_delay_ms)
		VALUES (@guild_id, @enabled, @wake_word, @sensitivity, @require_dj, @ack_mode, @text_channel_id, @silence_ms, @max_utterance_ms, @follow_delay_ms)
		ON CONFLICT(guild_id) DO UPDATE SET
		enabled=excluded.enabled,
		wake_word=excluded.wake_word,
		sensitivity=excluded.sensitivity,
		require_dj=excluded.require_dj,
		ack_mode=excluded.ack_mode,
		text_channel_id=excluded.text_channel_id,
		silence_ms=excluded.silence_ms,
		max_utterance_ms=excluded.max_utterance_ms,
		follow_delay_ms=excluded.follow_delay_ms`
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
		follow_delay_ms: config.follow_delay_ms ?? curr.follow_delay_ms
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

/**
 * Whether this member has asked Lyra to follow them into voice.
 *
 * Opt-in, per member, per guild: the assistant joining is something you ask for, not
 * something that happens to you.
 */
export function isVoiceFollowEnabled(guildId: string, userId: string): boolean {
	return db.prepare('SELECT 1 FROM voice_assistant_follow WHERE guild_id = ? AND user_id = ?').get(guildId, userId) !== undefined;
}

export function setVoiceFollow(guildId: string, userId: string, follow: boolean): void {
	if (follow) {
		db.prepare('INSERT OR IGNORE INTO voice_assistant_follow (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
	} else {
		db.prepare('DELETE FROM voice_assistant_follow WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
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
