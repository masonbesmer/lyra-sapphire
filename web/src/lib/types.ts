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

export interface SearchResponse {
	tracks: SerializedTrack[];
}

export interface MusicConfig {
	guild_id: string;
	dj_role_id: string | null;
	default_volume: number;
	announce_tracks: boolean;
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
	| { type: 'loopChange'; mode: LoopMode }
	| ({ type: 'voiceState' } & VoiceState)
	| { type: 'error'; message: string };
