/**
 * Spotify link support for /play. Spotify is only a metadata source: each track is looked up
 * through the Web API and then played from YouTube by searching "artist - title".
 */

const ACCOUNTS_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_ORIGIN = 'https://api.spotify.com';
const API_BASE = `${API_ORIGIN}/v1`;
const TIMEOUT_MS = 10_000;
/** Refresh this long before Spotify's stated expiry so a token never dies mid-request. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Albums and playlists queue at most this many tracks; each one costs a YouTube search. */
export const SPOTIFY_TRACK_LIMIT = 100;
const PAGE_SIZE = 50;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export type SpotifyResource = { kind: 'track' | 'album' | 'playlist'; id: string };
/** `unsupported` is a Spotify link of a kind /play cannot queue, such as an artist or podcast. */
export type SpotifyLink = SpotifyResource | { kind: 'unsupported' };

export interface SpotifyTrack {
	artist: string;
	title: string;
}

export interface SpotifyCollection {
	/** The album or playlist name; null for a single track. */
	name: string | null;
	tracks: SpotifyTrack[];
	/** How many tracks the album or playlist really has, before {@link SPOTIFY_TRACK_LIMIT}. */
	total: number;
}

/** A failure whose message is written for the user who pasted the link. */
export class SpotifyError extends Error {}

/**
 * Recognises `open.spotify.com` URLs (with or without an `intl-xx` locale segment) and
 * `spotify:` URIs. Returns null for anything that is not a Spotify link at all.
 */
export function parseSpotifyLink(query: string): SpotifyLink | null {
	const input = query.trim();
	let segments: string[];
	if (/^spotify:\S+$/i.test(input)) {
		segments = input.split(':').slice(1);
	} else {
		let url: URL;
		try {
			url = new URL(input);
		} catch {
			return null;
		}
		if (!/^https?:$/.test(url.protocol) || url.hostname.toLowerCase() !== 'open.spotify.com') return null;
		segments = url.pathname.split('/').filter(Boolean);
		if (segments[0]?.toLowerCase().startsWith('intl-')) segments = segments.slice(1);
	}

	const [kind, id, ...rest] = segments;
	if ((kind === 'track' || kind === 'album' || kind === 'playlist') && id && SPOTIFY_ID.test(id) && !rest.length) return { kind, id };
	return { kind: 'unsupported' };
}

/** The YouTube search that stands in for a Spotify track. */
export function spotifySearchQuery(track: SpotifyTrack): string {
	return track.artist ? `${track.artist} - ${track.title}` : track.title;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
	if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

	const clientId = process.env.SPOTIFY_CLIENT_ID;
	const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new SpotifyError("❌ Spotify links aren't set up on this bot (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET). Search by name instead.");
	}

	const response = await fetch(ACCOUNTS_TOKEN_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials',
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`Spotify token request failed: HTTP ${response.status}`);

	const body = (await response.json()) as { access_token: string; expires_in: number };
	cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS };
	return body.access_token;
}

async function spotifyGet<T>(pathOrUrl: string, resource: SpotifyResource): Promise<T> {
	const url = new URL(pathOrUrl.startsWith('https://') ? pathOrUrl : `${API_BASE}${pathOrUrl}`);
	// Paging `next` links arrive as absolute URLs; the bearer token must never leave Spotify's API.
	if (url.origin !== API_ORIGIN) throw new Error(`refusing to send the Spotify token to ${url.origin}`);
	const token = await getAccessToken();
	const response = await fetch(url.href, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (response.ok) return (await response.json()) as T;

	if (response.status === 401) cachedToken = null;
	// Spotify serves playlist contents only to the playlist's owner or a collaborator, and a
	// client-credentials token belongs to no user, so every playlist answers 403.
	if (response.status === 403 && resource.kind === 'playlist') {
		throw new SpotifyError("❌ Spotify won't share that playlist's tracks with the bot. Try an album or single track link.");
	}
	if (response.status === 404) throw new SpotifyError(`❌ couldn't find that ${resource.kind} on Spotify.`);
	if (response.status === 429) throw new SpotifyError('❌ Spotify is rate limiting the bot right now, try again in a minute.');
	throw new Error(`Spotify GET ${url.pathname} failed: HTTP ${response.status}`);
}

interface ApiTrack {
	type?: string;
	name?: string;
	artists?: { name: string }[];
}

interface ApiPage<T> {
	items: T[];
	next: string | null;
	total: number;
}

function toTrack(track: ApiTrack | null | undefined): SpotifyTrack | null {
	if (!track?.name || (track.type && track.type !== 'track')) return null;
	return { artist: track.artists?.[0]?.name ?? '', title: track.name };
}

/** Walks a paging object until {@link SPOTIFY_TRACK_LIMIT} entries have been read. */
async function collectPages<T>(first: ApiPage<T>, resource: SpotifyResource): Promise<T[]> {
	const items = [...first.items];
	let next = first.next;
	while (next && items.length < SPOTIFY_TRACK_LIMIT) {
		const page = await spotifyGet<ApiPage<T>>(next, resource);
		items.push(...page.items);
		next = page.next;
	}
	return items.slice(0, SPOTIFY_TRACK_LIMIT);
}

/**
 * Looks up the tracks behind a Spotify link. Throws {@link SpotifyError} for anything the user
 * should be told, including missing credentials.
 */
export async function fetchSpotifyTracks(resource: SpotifyResource): Promise<SpotifyCollection> {
	const { kind, id } = resource;
	if (kind === 'track') {
		const track = toTrack(await spotifyGet<ApiTrack>(`/tracks/${id}`, resource));
		return { name: null, tracks: track ? [track] : [], total: 1 };
	}

	if (kind === 'album') {
		const album = await spotifyGet<{ name: string; tracks: ApiPage<ApiTrack> }>(`/albums/${id}`, resource);
		const items = await collectPages(album.tracks, resource);
		return { name: album.name, tracks: items.map(toTrack).filter((t) => t !== null), total: album.tracks.total };
	}

	const firstPage = await spotifyGet<ApiPage<{ item: ApiTrack | null }>>(`/playlists/${id}/items?limit=${PAGE_SIZE}`, resource);
	const items = await collectPages(firstPage, resource);
	const playlist = await spotifyGet<{ name: string }>(`/playlists/${id}?fields=name`, resource);
	return { name: playlist.name, tracks: items.map((entry) => toTrack(entry.item)).filter((t) => t !== null), total: firstPage.total };
}

/**
 * Resolves Spotify tracks to playable ones a few at a time, in order, handing each batch's
 * hits to `onBatch` as soon as it lands so playback can start before the whole list is done.
 * `onBatch` returning false stops the walk, e.g. because the player was destroyed meanwhile.
 * A search that throws is counted in `failed` rather than ending the walk.
 */
export async function resolveInBatches<T>(
	tracks: readonly SpotifyTrack[],
	search: (query: string) => Promise<T | undefined>,
	onBatch: (found: T[]) => Promise<boolean>,
	batchSize = 5
): Promise<{ found: number; failed: number; stopped: boolean }> {
	let found = 0;
	let failed = 0;
	for (let i = 0; i < tracks.length; i += batchSize) {
		const batch = await Promise.allSettled(tracks.slice(i, i + batchSize).map((t) => search(spotifySearchQuery(t))));
		const hits: T[] = [];
		for (const outcome of batch) {
			if (outcome.status === 'rejected') failed++;
			else if (outcome.value !== undefined) hits.push(outcome.value);
		}
		found += hits.length;
		if (hits.length && !(await onBatch(hits))) return { found, failed, stopped: true };
	}
	return { found, failed, stopped: false };
}
