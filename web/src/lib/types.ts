// Mirrors the shapes actually returned by the server - see:
//   src/lib/music.ts (serializeTrack/serializePlayer)
//   src/lib/websocket.ts (broadcastEvent/broadcastQueueUpdate)
//   src/routes/api/**

export type LoopMode = 'none' | 'queue' | 'track';

export interface SerializedTrack {
	title: string;
	url: string | null;
	thumbnail: string | null;
	duration: string;
	durationMS: number;
	author: string | null;
	requestedBy: { id: string; username: string } | null;
}

export interface SerializedPlayer {
	current: SerializedTrack | null;
	tracks: SerializedTrack[];
	volume: number;
	paused: boolean;
	loop: LoopMode;
	filters: string[];
	/** 15-band custom equalizer gains, -0.25 to 1.0 - see lavalinkFilters.EQ_BAND_FREQUENCIES. */
	eq: number[];
	position: number;
}

export interface DiscordUser {
	id: string;
	username: string;
	avatar: string | null;
	global_name?: string | null;
}

export interface Guild {
	id: string;
	name: string;
	icon: string | null;
	slug: string;
	/** Manage Server in this guild - gates the Config tab. The server re-checks it on every write. */
	admin: boolean;
}

/** Where the logged-in member is sitting - the dashboard queues into this channel. */
export interface VoiceState {
	channelId: string | null;
	channelName: string | null;
}

export interface HistoryRow {
	id: number;
	guild_id: string;
	user_id: string;
	track_title: string;
	/** Null for tracks Lavalink gave no URI for - see playerStart.ts, which writes `track.uri ?? null`. */
	track_url: string | null;
	track_duration_ms: number;
	source: string | null;
	played_at: string;
}

export interface HistoryPage {
	page: number;
	rows: HistoryRow[];
}

export interface LeaderboardEntry {
	userId: string;
	username: string;
	value: number;
}

export interface FiltersResponse {
	active: string[];
	available: string[];
}

export interface EqualizerResponse {
	gains: number[];
	frequencies: number[];
	presets: string[];
}

export interface SearchResponse {
	tracks: SerializedTrack[];
}

export interface MusicConfig {
	guild_id: string;
	dj_role_id: string | null;
	default_volume: number;
	announce_tracks: boolean;
	announce_channel_id: string | null;
}

export interface StarboardConfig {
	guild_id: string;
	channel_id: string | null;
	threshold: number;
	emoji: string;
	enabled: boolean;
	self_star: boolean;
}

export type BlacklistTargetType = 'channel' | 'user';

export interface BlacklistEntry {
	target_id: string;
	target_type: BlacklistTargetType;
	/** Resolved channel/user name, falling back to the raw ID when it isn't cached. */
	name: string;
}

export type AckMode = 'text' | 'none' | 'tts';

export interface VoiceAssistantConfig {
	guild_id: string;
	enabled: boolean;
	wake_word: string;
	sensitivity: number;
	require_dj: boolean;
	ack_mode: AckMode;
	text_channel_id: string | null;
	silence_ms: number;
	max_utterance_ms: number;
	triggers_enabled: boolean;
}

export interface CommandPermission {
	command_name: string;
	required_role_id: string;
}

export interface WordTrigger {
	keyword: string;
	response: string;
}

export type VoiceTriggerResponseType = 'text' | 'sound' | 'speak';

export interface VoiceWordTrigger {
	keyword: string;
	response_type: VoiceTriggerResponseType;
	/** Reply text for a 'text' trigger, or the stored clip's name for a 'sound' one. */
	response: string;
	cooldown_ms: number;
}

export interface NamedId {
	id: string;
	name: string;
}

/** Everything the Config tab renders, from GET /api/guilds/:guild/admin. */
export interface AdminConfig {
	music: MusicConfig;
	starboard: StarboardConfig;
	starboard_blacklist: BlacklistEntry[];
	voice: VoiceAssistantConfig;
	command_permissions: CommandPermission[];
	word_triggers: WordTrigger[];
	voice_word_triggers: VoiceWordTrigger[];
	/** Clip names available to a sound trigger. Uploading a new one happens in Discord. */
	voice_sounds: string[];
	roles: NamedId[];
	text_channels: NamedId[];
	commands: string[];
}

// ── Config audit ────────────────────────────────────────────────────────────

export type AuditSection = 'music' | 'starboard' | 'starboard_blacklist' | 'voice' | 'permissions' | 'triggers' | 'voice_triggers';

/** Whether the change came in through this dashboard or a Discord command. */
export type AuditSource = 'dashboard' | 'discord';

export interface AuditRow {
	id: number;
	guild_id: string;
	actor_id: string;
	actor_name: string;
	source: AuditSource;
	section: AuditSection;
	/** Field name for the config groups, or the item key (keyword, command, `channel:<id>`) for the lists. */
	setting: string;
	/** null means the setting was unset - distinct from the literal string 'null'. */
	old_value: string | null;
	new_value: string | null;
	/** Server-resolved display for a value that is a role/channel/user ID, else the raw value. */
	old_label: string | null;
	new_label: string | null;
	created_at: string;
}

export interface AuditPage {
	page: number;
	limit: number;
	/** Sections this guild actually has rows for, so the filter offers nothing empty. */
	sections: AuditSection[];
	rows: AuditRow[];
}

// ── WebSocket messages ──────────────────────────────────────────────────────

export interface WsTrackStartTrack {
	title: string;
	url: string | null;
	thumbnail: string | null;
	durationMS: number;
	author: string | null;
}

export type WsServerMessage =
	| { type: 'queueUpdate'; queue: SerializedPlayer }
	| { type: 'trackStart'; track: WsTrackStartTrack }
	| { type: 'trackProgress'; position: number; duration: number }
	| { type: 'disconnected' }
	| { type: 'pauseStateChange'; paused: boolean }
	| { type: 'volumeChange'; volume: number }
	| { type: 'filterChange'; active?: string[]; preset?: string }
	| { type: 'eqChange'; gains: number[] }
	| { type: 'loopChange'; mode: LoopMode }
	| ({ type: 'voiceState' } & VoiceState)
	| { type: 'error'; message: string };
