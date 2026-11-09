import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SpotifyModule = typeof import('../../src/lib/spotify');

const ID = '4uLU6hMCjMI75M1A2tKUQC';

// Re-imported per test so the module-level token cache starts empty.
let spotify: SpotifyModule;
beforeEach(async () => {
	vi.resetModules();
	spotify = await import('../../src/lib/spotify.js');
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('parseSpotifyLink', () => {
	it.each([
		[`https://open.spotify.com/track/${ID}`, 'track'],
		[`https://open.spotify.com/album/${ID}?si=abc123`, 'album'],
		[`https://open.spotify.com/playlist/${ID}`, 'playlist'],
		[`https://open.spotify.com/intl-de/track/${ID}`, 'track'],
		[`spotify:track:${ID}`, 'track'],
		[`spotify:album:${ID}`, 'album'],
		[`spotify:playlist:${ID}`, 'playlist'],
		[`  https://open.spotify.com/track/${ID}  `, 'track']
	])('parses %s', (input, kind) => {
		expect(spotify.parseSpotifyLink(input)).toEqual({ kind, id: ID });
	});

	it.each([
		`https://open.spotify.com/artist/${ID}`,
		`https://open.spotify.com/episode/${ID}`,
		'https://open.spotify.com/track/short',
		'https://open.spotify.com/',
		`spotify:artist:${ID}`,
		'spotify:track:'
	])('flags %s as an unsupported Spotify link', (input) => {
		expect(spotify.parseSpotifyLink(input)).toEqual({ kind: 'unsupported' });
	});

	it.each([
		'never gonna give you up',
		'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		`https://evil.example/open.spotify.com/track/${ID}`,
		`https://open.spotify.com.evil.example/track/${ID}`
	])('leaves %s to the normal search', (input) => {
		expect(spotify.parseSpotifyLink(input)).toBeNull();
	});
});

describe('spotifySearchQuery', () => {
	it('searches "artist - title"', () => {
		expect(spotify.spotifySearchQuery({ artist: 'Rick Astley', title: 'Never Gonna Give You Up' })).toBe('Rick Astley - Never Gonna Give You Up');
	});

	it('falls back to the title without an artist', () => {
		expect(spotify.spotifySearchQuery({ artist: '', title: 'Untitled' })).toBe('Untitled');
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubSpotify(routes: (url: string) => Response) {
	const fetchMock = vi.fn(async (input: string | URL) => {
		const url = String(input);
		if (url.startsWith('https://accounts.spotify.com/')) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
		return routes(url);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function apiTrack(n: number) {
	return { type: 'track', name: `Song ${n}`, artists: [{ name: `Artist ${n}` }, { name: 'Feature' }] };
}

describe('fetchSpotifyTracks', () => {
	beforeEach(() => {
		vi.stubEnv('SPOTIFY_CLIENT_ID', 'id');
		vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'secret');
	});

	it('rejects with a user-facing error and makes no request when credentials are unset', async () => {
		vi.stubEnv('SPOTIFY_CLIENT_ID', '');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const error = await spotify.fetchSpotifyTracks({ kind: 'track', id: ID }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(spotify.SpotifyError);
		expect((error as Error).message).toContain('SPOTIFY_CLIENT_ID');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('looks up a track by its primary artist and reuses the cached token', async () => {
		const fetchMock = stubSpotify(() => jsonResponse(apiTrack(1)));

		const first = await spotify.fetchSpotifyTracks({ kind: 'track', id: ID });
		await spotify.fetchSpotifyTracks({ kind: 'track', id: ID });

		expect(first).toEqual({ name: null, tracks: [{ artist: 'Artist 1', title: 'Song 1' }], total: 1 });
		expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://accounts.spotify.com/'))).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.spotify.com/v1/tracks/${ID}`,
			expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
		);
	});

	it('fetches a new token once the cached one is about to expire', async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = stubSpotify(() => jsonResponse(apiTrack(1)));
			const tokenRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://accounts.spotify.com/')).length;

			await spotify.fetchSpotifyTracks({ kind: 'track', id: ID });
			vi.advanceTimersByTime(3600_000 - 61_000);
			await spotify.fetchSpotifyTracks({ kind: 'track', id: ID });
			expect(tokenRequests()).toBe(1);

			vi.advanceTimersByTime(2_000);
			await spotify.fetchSpotifyTracks({ kind: 'track', id: ID });
			expect(tokenRequests()).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('drops a token Spotify rejects', async () => {
		let reject = true;
		const fetchMock = stubSpotify(() => (reject ? ((reject = false), jsonResponse({}, 401)) : jsonResponse(apiTrack(1))));

		await expect(spotify.fetchSpotifyTracks({ kind: 'track', id: ID })).rejects.toThrow(/HTTP 401/);
		await spotify.fetchSpotifyTracks({ kind: 'track', id: ID });

		expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://accounts.spotify.com/'))).toHaveLength(2);
	});

	it('pages through an album up to the track limit', async () => {
		const page = (offset: number) => ({
			items: Array.from({ length: 50 }, (_, i) => apiTrack(offset + i)),
			next: `https://api.spotify.com/v1/albums/${ID}/tracks?offset=${offset + 50}`,
			total: 250
		});
		const fetchMock = stubSpotify((url) => {
			if (url.endsWith(`/albums/${ID}`)) return jsonResponse({ name: 'Big Album', tracks: page(0) });
			return jsonResponse(page(Number(new URL(url).searchParams.get('offset'))));
		});

		const album = await spotify.fetchSpotifyTracks({ kind: 'album', id: ID });

		expect(album.name).toBe('Big Album');
		expect(album.total).toBe(250);
		expect(album.tracks).toHaveLength(spotify.SPOTIFY_TRACK_LIMIT);
		expect(album.tracks.at(-1)).toEqual({
			artist: `Artist ${spotify.SPOTIFY_TRACK_LIMIT - 1}`,
			title: `Song ${spotify.SPOTIFY_TRACK_LIMIT - 1}`
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('never sends the token to a paging link outside the Spotify API', async () => {
		const fetchMock = stubSpotify(() =>
			jsonResponse({ name: 'Album', tracks: { items: [apiTrack(1)], next: 'https://evil.example/v1/page2', total: 60 } })
		);

		await expect(spotify.fetchSpotifyTracks({ kind: 'album', id: ID })).rejects.toThrow(/evil\.example/);
		expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).origin)).not.toContain('https://evil.example');
	});

	it('skips podcast episodes and empty entries in a playlist', async () => {
		stubSpotify((url) => {
			if (url.includes('/items'))
				return jsonResponse({
					items: [{ item: apiTrack(1) }, { item: { type: 'episode', name: 'Pod' } }, { item: null }],
					next: null,
					total: 3
				});
			return jsonResponse({ name: 'Mix' });
		});

		expect(await spotify.fetchSpotifyTracks({ kind: 'playlist', id: ID })).toEqual({
			name: 'Mix',
			tracks: [{ artist: 'Artist 1', title: 'Song 1' }],
			total: 3
		});
	});

	it('explains a playlist Spotify refuses to share', async () => {
		stubSpotify(() => jsonResponse({ error: { status: 403 } }, 403));
		await expect(spotify.fetchSpotifyTracks({ kind: 'playlist', id: ID })).rejects.toThrow(/won't share that playlist/);
	});

	it('reports a missing resource to the user', async () => {
		stubSpotify(() => jsonResponse({ error: { status: 404 } }, 404));
		await expect(spotify.fetchSpotifyTracks({ kind: 'album', id: ID })).rejects.toBeInstanceOf(spotify.SpotifyError);
	});

	it('treats other API failures as internal errors', async () => {
		stubSpotify(() => jsonResponse({}, 500));
		const error = await spotify.fetchSpotifyTracks({ kind: 'track', id: ID }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(spotify.SpotifyError);
	});
});

describe('resolveInBatches', () => {
	const tracks = Array.from({ length: 7 }, (_, i) => ({ artist: 'A', title: `${i}` }));

	it('hands over hits batch by batch, in order, dropping misses and failed searches', async () => {
		const batches: string[][] = [];
		const search = async (q: string) => {
			if (q === 'A - 1') return undefined;
			if (q === 'A - 2') throw new Error('lavalink down');
			return q;
		};

		const result = await spotify.resolveInBatches(tracks, search, async (found) => (batches.push(found), true), 3);

		expect(batches).toEqual([['A - 0'], ['A - 3', 'A - 4', 'A - 5'], ['A - 6']]);
		expect(result).toEqual({ found: 5, failed: 1, stopped: false });
	});

	it('stops searching once onBatch declines', async () => {
		const search = vi.fn(async (q: string) => q);
		const result = await spotify.resolveInBatches(tracks, search, async () => false, 3);

		expect(result.stopped).toBe(true);
		expect(search).toHaveBeenCalledTimes(3);
	});
});
