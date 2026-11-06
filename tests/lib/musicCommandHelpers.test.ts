import { describe, expect, it, vi } from 'vitest';
import { DATA_ACTIVE_FILTERS } from '../../src/lib/lavalinkFilters';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel, searchTracks } from '../../src/lib/musicCommandHelpers';
import { PLAYER_META_KEY } from '../../src/lib/queueMetadata';

const OPTS = { guildId: 'g1', voiceId: 'v1', textId: 't1', volume: 60 };

describe('getOrCreatePlayer', () => {
	it('reuses an existing player in the same channel', async () => {
		const existing = { voiceId: 'v1', setVoiceChannel: vi.fn() };
		const kazagumo = { getPlayer: vi.fn(() => existing), createPlayer: vi.fn() };
		expect(await getOrCreatePlayer(kazagumo as never, OPTS)).toBe(existing);
		expect(existing.setVoiceChannel).not.toHaveBeenCalled();
		expect(kazagumo.createPlayer).not.toHaveBeenCalled();
	});

	it('moves an existing player to the requested channel', async () => {
		const existing = { voiceId: 'old', setVoiceChannel: vi.fn() };
		const kazagumo = { getPlayer: () => existing, createPlayer: vi.fn() };
		await getOrCreatePlayer(kazagumo as never, OPTS);
		expect(existing.setVoiceChannel).toHaveBeenCalledWith('v1');
	});

	it('creates a deafened player when none exists', async () => {
		const created = {};
		const kazagumo = { getPlayer: () => undefined, createPlayer: vi.fn(async () => created) };
		expect(await getOrCreatePlayer(kazagumo as never, OPTS)).toBe(created);
		expect(kazagumo.createPlayer).toHaveBeenCalledWith({ guildId: 'g1', voiceId: 'v1', textId: 't1', deaf: true, volume: 60 });
	});
});

describe('initPlayerMeta', () => {
	it('stores the meta and initialises active filters', () => {
		const player = { data: new Map<string, unknown>() };
		const meta = { channelId: 't1' } as never;
		initPlayerMeta(player as never, meta);
		expect(player.data.get(PLAYER_META_KEY)).toBe(meta);
		expect(player.data.get(DATA_ACTIVE_FILTERS)).toBeInstanceOf(Set);
	});

	it('keeps existing active filters', () => {
		const filters = new Set(['8D']);
		const player = { data: new Map<string, unknown>([[DATA_ACTIVE_FILTERS, filters]]) };
		initPlayerMeta(player as never, {} as never);
		expect(player.data.get(DATA_ACTIVE_FILTERS)).toBe(filters);
	});
});

describe('queueAndLabel', () => {
	// Mirrors KazagumoQueue#add shifting the array it is handed, and records what it was given.
	function fakePlayer(state: { playing?: boolean; paused?: boolean } = {}) {
		const added: unknown[][] = [];
		const add = vi.fn((tracks: unknown[]) => {
			added.push([...tracks]);
			tracks.shift();
		});
		return { playing: false, paused: false, ...state, added, queue: { add }, play: vi.fn(async () => {}) };
	}

	it('reports when nothing was found', async () => {
		const player = fakePlayer();
		expect(await queueAndLabel(player as never, { type: 'SEARCH', tracks: [] } as never)).toBe("❌ couldn't find anything playable for that.");
		expect(player.queue.add).not.toHaveBeenCalled();
	});

	it('queues only the first search hit and starts playback', async () => {
		const player = fakePlayer();
		const result = { type: 'SEARCH', tracks: [{ title: 'One' }, { title: 'Two' }] };
		expect(await queueAndLabel(player as never, result as never)).toBe('✅ queued **One**');
		expect(player.added).toEqual([[{ title: 'One' }]]);
		expect(player.play).toHaveBeenCalled();
	});

	it('counts a playlist before the queue mutates it', async () => {
		const player = fakePlayer();
		const result = { type: 'PLAYLIST', playlistName: 'Mix', tracks: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] };
		expect(await queueAndLabel(player as never, result as never)).toBe('✅ queued playlist **Mix** (3 tracks)');
	});

	it('labels an unnamed playlist', async () => {
		const result = { type: 'PLAYLIST', tracks: [{ title: 'a' }] };
		expect(await queueAndLabel(fakePlayer() as never, result as never)).toBe('✅ queued playlist **Unknown** (1 tracks)');
	});

	it.each([{ playing: true }, { paused: true }])('does not restart playback when %o', async (state) => {
		const player = fakePlayer(state);
		await queueAndLabel(player as never, { type: 'TRACK', tracks: [{ title: 'x' }] } as never);
		expect(player.play).not.toHaveBeenCalled();
	});
});

describe('searchTracks', () => {
	const requester = { id: 'u1' };

	function fakeKazagumo(...results: { tracks: unknown[] }[]) {
		const search = vi.fn();
		for (const result of results) search.mockResolvedValueOnce(result);
		return { search };
	}

	it('returns youtube results when there are any', async () => {
		const hit = { tracks: [{}] };
		const kazagumo = fakeKazagumo(hit);
		expect(await searchTracks(kazagumo as never, 'song', { requester })).toBe(hit);
		expect(kazagumo.search).toHaveBeenCalledExactlyOnceWith('song', { requester, engine: 'youtube' });
	});

	it('falls back to youtube_music when youtube is empty', async () => {
		const fallback = { tracks: [{}] };
		const kazagumo = fakeKazagumo({ tracks: [] }, fallback);
		expect(await searchTracks(kazagumo as never, 'song', { requester })).toBe(fallback);
		expect(kazagumo.search).toHaveBeenLastCalledWith('song', { requester, engine: 'youtube_music' });
	});

	it('does not fall back for URLs or other engines', async () => {
		const urlKazagumo = fakeKazagumo({ tracks: [] });
		await searchTracks(urlKazagumo as never, 'https://youtu.be/x', { requester });
		expect(urlKazagumo.search).toHaveBeenCalledTimes(1);

		const scKazagumo = fakeKazagumo({ tracks: [] });
		await searchTracks(scKazagumo as never, 'song', { requester, engine: 'soundcloud' });
		expect(scKazagumo.search).toHaveBeenCalledTimes(1);
	});
});
