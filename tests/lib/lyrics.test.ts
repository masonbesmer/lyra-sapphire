import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLyricsEmbeds, buildLyricsQuery, fetchLyrics, pickBestEntry, stripLrcTimestamps, type LrclibEntry } from '../../src/lib/lyrics';

describe('buildLyricsEmbeds', () => {
	it('splits lyrics into 4096-character embeds', () => {
		const embeds = buildLyricsEmbeds('Song', 'x'.repeat(4096 * 2 + 10));
		expect(embeds.map((embed) => embed.toJSON().description?.length)).toEqual([4096, 4096, 10]);
	});

	it('prefixes the title and clamps it to 256 characters', () => {
		const [short] = buildLyricsEmbeds('Song', 'la la');
		expect(short.toJSON().title).toBe('📜 Song');

		const [long] = buildLyricsEmbeds('t'.repeat(300), 'la la');
		expect(long.toJSON().title).toHaveLength(256);
	});

	it('returns no embeds for empty lyrics', () => {
		expect(buildLyricsEmbeds('Song', '')).toEqual([]);
	});
});

describe('buildLyricsQuery', () => {
	it('splits "Artist - Song" video titles and drops video junk and features', () => {
		expect(buildLyricsQuery({ title: 'The Killers - Mr. Brightside (Official Music Video)', author: 'TheKillersVEVO', length: 227_000 })).toEqual(
			{
				artist: 'The Killers',
				title: 'Mr. Brightside',
				durationSec: 227
			}
		);
		expect(buildLyricsQuery({ title: 'Calvin Harris - Feel So Close (feat. Someone) [Official Video]' })).toMatchObject({
			artist: 'Calvin Harris',
			title: 'Feel So Close'
		});
	});

	it('falls back to a cleaned uploader name for the artist', () => {
		expect(buildLyricsQuery({ title: 'Bohemian Rhapsody (Remastered 2011)', author: 'Queen - Topic' })).toEqual({
			artist: 'Queen',
			title: 'Bohemian Rhapsody',
			durationSec: null
		});
		expect(buildLyricsQuery({ title: 'Like a Stone', author: 'AudioslaveVEVO' }).artist).toBe('Audioslave');
	});

	it('leaves the artist unknown for bare user text', () => {
		expect(buildLyricsQuery({ title: 'mr brightside' })).toEqual({ artist: null, title: 'mr brightside', durationSec: null });
	});
});

describe('stripLrcTimestamps', () => {
	it('removes leading LRC timestamps from each line', () => {
		expect(stripLrcTimestamps('[00:01.00] first\n[00:02.50][00:10.00] second\n[00:03.00]')).toBe('first\nsecond');
	});
});

const entry = (overrides: Partial<LrclibEntry> = {}): LrclibEntry => ({
	trackName: 'Bohemian Rhapsody',
	artistName: 'Queen',
	duration: 355,
	instrumental: false,
	plainLyrics: 'Is this the real life?',
	syncedLyrics: null,
	...overrides
});

describe('pickBestEntry', () => {
	const query = { artist: 'Queen', title: 'Bohemian Rhapsody', durationSec: 354 };

	it('prefers the matching artist and duration over covers', () => {
		const cover = entry({ artistName: 'Some Cover Band', duration: 400 });
		const real = entry();
		expect(pickBestEntry([cover, real], query)).toBe(real);
	});

	it('skips instrumentals and entries without lyrics', () => {
		expect(pickBestEntry([entry({ instrumental: true }), entry({ plainLyrics: null })], query)).toBeNull();
	});

	it('rejects unrelated results rather than showing the wrong song', () => {
		expect(pickBestEntry([entry({ trackName: 'Something Else', artistName: 'Nobody', duration: null })], query)).toBeNull();
	});

	it('favours the artist the user typed in free text', () => {
		const junk = entry({ trackName: 'radiohead creep', artistName: 'radiohead creep' });
		const real = entry({ trackName: 'Creep', artistName: 'Radiohead' });
		expect(pickBestEntry([junk, real], { artist: null, title: 'radiohead creep', durationSec: null })).toBe(real);
	});

	it('uses synced lyrics when plain lyrics are missing', () => {
		expect(pickBestEntry([entry({ plainLyrics: null, syncedLyrics: '[00:01.00] Is this the real life?' })], query)).not.toBeNull();
	});
});

describe('fetchLyrics', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns the LRCLIB exact match for a playing track', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const parsed = new URL(url);
			expect(parsed.pathname).toBe('/api/get');
			expect(parsed.searchParams.get('artist_name')).toBe('Queen');
			expect(parsed.searchParams.get('track_name')).toBe('Bohemian Rhapsody');
			expect(parsed.searchParams.get('duration')).toBe('355');
			return new Response(JSON.stringify(entry()), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			fetchLyrics({ title: 'Queen - Bohemian Rhapsody (Official Video)', author: 'Queen Official', length: 355_000 })
		).resolves.toEqual({
			lyrics: 'Is this the real life?',
			title: 'Queen - Bohemian Rhapsody',
			source: 'lrclib'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to free-text search for user queries', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const parsed = new URL(url);
			expect(parsed.pathname).toBe('/api/search');
			expect(parsed.searchParams.get('q')).toBe('bohemian rhapsody');
			return new Response(JSON.stringify([entry({ trackName: 'Unrelated', artistName: 'X' }), entry()]), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchLyrics('bohemian rhapsody')).resolves.toMatchObject({ title: 'Queen - Bohemian Rhapsody', source: 'lrclib' });
	});

	it('moves on to field search when the exact lookup 404s', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const parsed = new URL(url);
			if (parsed.pathname === '/api/get') return new Response('{"code":404}', { status: 404 });
			expect(parsed.searchParams.get('artist_name')).toBe('Queen');
			return new Response(JSON.stringify([entry()]), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchLyrics({ title: 'Bohemian Rhapsody', author: 'Queen - Topic', length: 354_000 })).resolves.toMatchObject({
			source: 'lrclib'
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
