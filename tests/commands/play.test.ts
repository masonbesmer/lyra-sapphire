import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserCommand } from '../../src/commands/music/play';
import { guildMember } from '../helpers/discord';

const ALBUM_ID = '4uLU6hMCjMI75M1A2tKUQC';
const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

function fakePlayer() {
	return {
		voiceId: 'v1',
		playing: false,
		paused: false,
		data: new Map<string, unknown>(),
		queue: { add: vi.fn() },
		play: vi.fn(async () => {})
	};
}

function install(search: (query: string) => Promise<unknown>) {
	const player = fakePlayer();
	let current: ReturnType<typeof fakePlayer> | undefined;
	const kazagumo = {
		search: vi.fn(search),
		getPlayer: vi.fn(() => current),
		createPlayer: vi.fn(async () => (current = player)),
		shoukaku: { nodes: new Map([['n1', { rest: { resolve: vi.fn(async () => ({ loadType: 'empty' })) } }]]) }
	};
	(container as any).client = { kazagumo, options: {} };
	(container as any).logger = logger;
	return { kazagumo, player };
}

/** Runs `%play <query>` and returns every edit made to the bot's status reply. */
async function runMessagePlay(query: string): Promise<string[]> {
	const edits: string[] = [];
	const statusMsg = { edit: vi.fn(async (content: string) => edits.push(content)) };
	const message = {
		guild: {},
		guildId: 'play-guild',
		channelId: 't1',
		author: { id: 'u1' },
		member: guildMember({ voice: { channel: { id: 'v1' } } }),
		reply: vi.fn(async () => statusMsg)
	};
	const args = { rest: async () => query };
	const command = new UserCommand({ name: 'play', path: '', root: '', store: null } as never, {} as never);
	await command.messageRun(message as never, args as never);
	return edits;
}

function track(title: string) {
	return { title, uri: `https://youtu.be/${title}` };
}

function stubSpotify(body: unknown) {
	vi.stubEnv('SPOTIFY_CLIENT_ID', 'id');
	vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'secret');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL) => {
			const auth = String(input).startsWith('https://accounts.spotify.com/');
			return new Response(JSON.stringify(auth ? { access_token: 'tok', expires_in: 3600 } : body), { status: 200 });
		})
	);
}

function stubSpotifyAlbum(names: string[], total = names.length) {
	stubSpotify({ name: 'Album', tracks: { items: names.map((name) => ({ type: 'track', name, artists: [{ name: 'A' }] })), next: null, total } });
}

beforeEach(() => {
	logger.error.mockClear();
	logger.warn.mockClear();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('/play', () => {
	it('searches a plain query as before and never touches Spotify', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { kazagumo, player } = install(async () => ({ type: 'SEARCH', tracks: [track('song')] }));

		expect(await runMessagePlay('never gonna give you up')).toEqual(['✅ queued **song**']);
		expect(kazagumo.search).toHaveBeenCalledWith('never gonna give you up', expect.objectContaining({ engine: 'youtube' }));
		expect(player.play).toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('tells the user Spotify is not configured when the credentials are unset', async () => {
		vi.stubEnv('SPOTIFY_CLIENT_ID', '');
		vi.stubEnv('SPOTIFY_CLIENT_SECRET', '');
		const { kazagumo } = install(async () => ({ type: 'SEARCH', tracks: [] }));

		const edits = await runMessagePlay(`https://open.spotify.com/track/${ALBUM_ID}`);

		expect(edits).toHaveLength(1);
		expect(edits[0]).toContain('SPOTIFY_CLIENT_ID');
		expect(kazagumo.search).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('queues a Spotify track from a YouTube search for "artist - title"', async () => {
		stubSpotify({ type: 'track', name: 'Song', artists: [{ name: 'A' }] });
		const { kazagumo, player } = install(async () => ({ type: 'SEARCH', tracks: [track('A - Song')] }));

		const edits = await runMessagePlay(`https://open.spotify.com/track/${ALBUM_ID}`);

		expect(kazagumo.search).toHaveBeenCalledWith('A - Song', expect.anything());
		expect(player.play).toHaveBeenCalled();
		expect(edits.at(-1)).toBe('✅ queued **A - Song**');
	});

	it('says so when a Spotify track has no YouTube match, and does not join', async () => {
		stubSpotify({ type: 'track', name: 'Song', artists: [{ name: 'A' }] });
		const { kazagumo } = install(async () => ({ type: 'SEARCH', tracks: [] }));

		const edits = await runMessagePlay(`https://open.spotify.com/track/${ALBUM_ID}`);

		expect(edits.at(-1)).toBe("❌ couldn't find that song on YouTube.");
		expect(kazagumo.createPlayer).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('empty search diagnostics: engine=youtube query="A - Song"'));
	});

	it('notes when an album is cut to the track limit', async () => {
		stubSpotifyAlbum(['s0', 's1'], 250);
		install(async (query) => ({ type: 'SEARCH', tracks: [track(query)] }));

		const edits = await runMessagePlay(`https://open.spotify.com/album/${ALBUM_ID}`);

		expect(edits.at(-1)).toBe('✅ queued album **Album** (2 tracks, first 100 of 250)');
	});

	it('stops queueing an album once the player is gone', async () => {
		stubSpotifyAlbum(Array.from({ length: 6 }, (_, i) => `s${i}`));
		const { kazagumo, player } = install(async (query) => ({ type: 'SEARCH', tracks: [track(query)] }));
		kazagumo.createPlayer.mockImplementation(async () => player);

		const edits = await runMessagePlay(`https://open.spotify.com/album/${ALBUM_ID}`);

		expect(edits.at(-1)).toBe('⏹️ stopped queueing album **Album** after 5 tracks, the player went away.');
		expect(player.queue.add).toHaveBeenCalledTimes(1);
	});

	it('reports failed searches instead of claiming the tracks do not exist', async () => {
		stubSpotifyAlbum(['ok', 'broken']);
		install(async (query) => {
			if (query === 'A - broken') throw new Error('lavalink down');
			return { type: 'SEARCH', tracks: [track(query)] };
		});

		const edits = await runMessagePlay(`https://open.spotify.com/album/${ALBUM_ID}`);

		expect(edits.at(-1)).toBe('✅ queued album **Album** (1 tracks, 1 searches failed)');
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('lavalink down'));
	});

	it('blames YouTube search, not the album, when every search fails', async () => {
		stubSpotifyAlbum(['s0', 's1']);
		const { kazagumo } = install(async () => {
			throw new Error('lavalink down');
		});

		const edits = await runMessagePlay(`https://open.spotify.com/album/${ALBUM_ID}`);

		expect(edits.at(-1)).toBe('❌ YouTube search failed for album **Album**, check the logs.');
		expect(kazagumo.createPlayer).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('empty search diagnostics'));
	});

	it('says none of an album was found, and logs diagnostics, when every search is empty', async () => {
		stubSpotifyAlbum(['s0', 's1']);
		const { kazagumo } = install(async () => ({ type: 'SEARCH', tracks: [] }));

		const edits = await runMessagePlay(`https://open.spotify.com/album/${ALBUM_ID}`);

		expect(edits.at(-1)).toBe("❌ couldn't find any of album **Album** on YouTube.");
		expect(kazagumo.createPlayer).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('empty search diagnostics: engine=youtube query="A - s0"'));
	});

	it('says how much was queued when queueing breaks part-way', async () => {
		stubSpotifyAlbum(Array.from({ length: 6 }, (_, i) => `s${i}`));
		const { player } = install(async (query) => ({ type: 'SEARCH', tracks: [track(query)] }));
		player.queue.add
			.mockImplementationOnce(() => {})
			.mockImplementationOnce(() => {
				throw new Error('queue broke');
			});

		const edits = await runMessagePlay(`https://open.spotify.com/album/${ALBUM_ID}`);

		expect(edits.at(-1)).toMatch(/^⚠️ queued 5 tracks of album \*\*Album\*\*/);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('queue broke'));
	});
});
