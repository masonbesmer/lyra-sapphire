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
	/** Any staff permission the Moderation tab covers. Advisory: each moderation route re-checks. */
	moderator: boolean;
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
	/** How long the music bot stays in voice after playback ends. 0 keeps it there. */
	idle_timeout_ms: number;
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
	/** How long after a member with follow on joins voice the assistant follows them in. */
	follow_delay_ms: number;
	/** Play a short tone when the wake word fires, so the speaker knows the assistant is listening. */
	wake_chime: boolean;
	/** Whether a server Google API key is stored. The key itself is write-only. */
	google_api_key_set: boolean;
	/** Whether a separate Cloud Speech key is stored. Also write-only. */
	google_speech_api_key_set: boolean;
	stt_provider: SpeechProvider;
	tts_provider: SpeechProvider;
	stt_language: string;
	tts_voice: string;
	gemini_model: string;
}

export type SpeechProvider = 'local' | 'google';

export interface CommandPermission {
	command_name: string;
	required_role_id: string;
}

export interface WordTrigger {
	keyword: string;
	response: string;
}

export interface NamedId {
	id: string;
	name: string;
}

/** Everything the Config tab renders, from GET /api/guilds/:guild/admin. */
/** A channel keyword replies stay out of. `name` falls back to the raw ID when uncached. */
export interface TriggerExclusion {
	channel_id: string;
	name: string;
}

export interface AdminConfig {
	music: MusicConfig;
	starboard: StarboardConfig;
	starboard_blacklist: BlacklistEntry[];
	voice: VoiceAssistantConfig;
	command_permissions: CommandPermission[];
	word_triggers: WordTrigger[];
	trigger_excluded_channels: TriggerExclusion[];
	roles: NamedId[];
	text_channels: NamedId[];
	/** Every path a role gate can be set on, subcommands included (`keyword add`). */
	commands: string[];
}

// ── Config audit ────────────────────────────────────────────────────────────

export type AuditSection = 'music' | 'starboard' | 'starboard_blacklist' | 'voice' | 'permissions' | 'triggers' | 'moderation';

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

// ── Moderation ──────────────────────────────────────────────────────────────
// Mirrors the /moderation routes (src/routes/api/guilds/[guild]/moderation*); tests/web/moderationContract.test.ts
// checks the server's shapes still satisfy these. `access` decides which panels show; every route
// re-checks the same Discord permission and /permissions role gates as its slash command.

export type ModScope = 'cases' | 'members' | 'notes' | 'logging' | 'automod' | 'antiraid' | 'roles';

export interface ModCase {
	guild_id: string;
	case_number: number;
	action: string;
	target_type: 'user' | 'channel' | 'guild';
	target_id: string;
	target_tag: string | null;
	moderator_id: string;
	moderator_tag: string | null;
	reason: string | null;
	duration_ms: number | null;
	expires_at: string | null;
	created_at: string;
	log_channel_id: string | null;
	log_message_id: string | null;
}

export interface ModCasePage {
	page: number;
	limit: number;
	total: number;
	cases: ModCase[];
}

export interface ModNote {
	id: number;
	author_id: string;
	author_tag: string | null;
	content: string;
	created_at: string;
}

export interface ModScheduledAction {
	id: number;
	action: 'unban' | 'role-remove';
	role_id: string;
	run_at: string;
	case_number: number | null;
}

export interface MemberHit {
	id: string;
	tag: string | null;
	display_name: string | null;
	avatar_url: string | null;
	in_server: boolean;
	cases: number;
}

export interface MemberHistory {
	id: string;
	tag: string | null;
	display_name: string | null;
	avatar_url: string | null;
	bot: boolean;
	created_at: string | null;
	in_server: boolean;
	joined_at: string | null;
	nickname: string | null;
	timeout_until: string | null;
	roles: { id: string; name: string }[];
	/** null = the bot can't see bans here; false = not banned. */
	ban: { reason: string | null } | false | null;
	active_warns: number;
	warn_expiry_ms: number | null;
	total_cases: number;
	cases: ModCase[];
	/** null when this moderator can't read notes (/note is gated separately). */
	notes: ModNote[] | null;
	scheduled: ModScheduledAction[];
}

export type LogIgnores = Record<'channel' | 'user', string[]>;

export interface LoggingConfig {
	groups: Record<string, readonly string[]>;
	labels: Record<string, string>;
	routes: Partial<Record<string, string>>;
	ignores: LogIgnores;
}

export interface AutomodRuleSettings {
	words?: string[];
	allow?: string[];
	mode?: 'block' | 'allow';
	domains?: string[];
	extensions?: string[];
	limit?: number;
	windowMs?: number;
}

export interface AutomodRule {
	rule: string;
	enabled: boolean;
	action: string;
	durationMs: number | null;
	settings: AutomodRuleSettings;
	exemptRoles: string[];
	exemptChannels: string[];
}

export interface AutomodSettings {
	nativeSync: boolean;
	exemptRoles: string[];
	exemptChannels: string[];
}

export interface AutomodConfig {
	rules: AutomodRule[];
	settings: AutomodSettings;
	actions: readonly string[];
	descriptions: Record<string, string>;
	limits: Partial<Record<string, { limit: readonly [number, number]; window?: readonly [number, number]; label: string }>>;
	list_keys: Partial<Record<string, 'words' | 'allow' | 'domains' | 'extensions'>>;
}

export interface AntiRaidSettings {
	enabled: boolean;
	join_threshold: number;
	join_window_ms: number;
	raid_lockdown: boolean;
	raid_join_action: string;
	raid_duration_ms: number;
	alert_channel_id: string | null;
	alert_role_id: string | null;
	min_account_age_ms: number;
	account_age_action: string;
	default_avatar_action: string;
	quarantine_role_id: string | null;
	quarantine_on_join: boolean;
	verify_role_id: string | null;
	verify_mode: string;
}

export interface AntiRaidConfig extends AntiRaidSettings {
	guild_id: string;
	raid_until: string | null;
	raid_locked: boolean;
	raid_join_count: number;
}

export interface AntiRaidOverview {
	config: AntiRaidConfig;
	raid_active: boolean;
	join_actions: readonly string[];
	verify_modes: readonly string[];
}

export interface RolePanelEntry {
	panel_id: number;
	role_id: string;
	role_name: string | null;
	emoji: string | null;
	label: string | null;
	position: number;
}

export interface RolePanel {
	id: number;
	channel_id: string;
	channel_name: string | null;
	message_id: string;
	kind: 'button' | 'select' | 'reaction';
	mode: 'normal' | 'unique' | 'verify' | 'drop';
	title: string | null;
	description: string | null;
	/** Lyra posted the message (so deleting the panel deletes it too). */
	owned: boolean;
	url: string;
	entries: RolePanelEntry[];
}

export interface PanelsOverview {
	list: RolePanel[];
	kinds: readonly RolePanel['kind'][];
	modes: readonly RolePanel['mode'][];
	mode_hints: Record<string, string>;
}

export interface ModOverview {
	access: Record<ModScope, boolean>;
	action_labels: Record<string, string>;
	roles: { id: string; name: string; managed: boolean }[];
	text_channels: { id: string; name: string }[];
	mod_log_channel_id: string | null;
	logging: LoggingConfig | null;
	automod: AutomodConfig | null;
	antiraid: AntiRaidOverview | null;
	panels: PanelsOverview | null;
}

// ── Playlists ───────────────────────────────────────────────────────────────
// Mirrors src/routes/api/guilds/_playlists.ts; tests/web/playlistContract.test.ts checks the
// server's shapes still satisfy these. The access flags come from the server's own authorization
// gate; the UI only uses them to hide controls the server would refuse.

export interface PlaylistAccess {
	read: boolean;
	create: boolean;
	update: boolean;
	delete: boolean;
	/** Owner only: visibility, grants and deleting the whole playlist. */
	manage: boolean;
}

export interface PlaylistSummary {
	id: number;
	name: string;
	description: string | null;
	isPublic: boolean;
	owner: { id: string; username: string };
	trackCount: number;
	totalLengthMs: number;
	coverUrl: string | null;
	access: PlaylistAccess;
}

export interface PlaylistTrack {
	id: number;
	/** 1-based, as the reorder route takes it. */
	position: number;
	title: string;
	uri: string | null;
	author: string | null;
	lengthMs: number;
	addedBy: string;
}

export interface PlaylistGrant {
	userId: string;
	username: string;
	create: boolean;
	read: boolean;
	update: boolean;
	delete: boolean;
}

export interface PlaylistDetail extends PlaylistSummary {
	tracks: PlaylistTrack[];
	/** Empty unless the viewer owns the playlist. */
	grants: PlaylistGrant[];
}

export interface PlaylistLists {
	owned: PlaylistSummary[];
	shared: PlaylistSummary[];
	public: PlaylistSummary[];
	/** Discord couldn't confirm some owners are in this server, so their public playlists are left out. */
	publicIncomplete: boolean;
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
