import { container } from '@sapphire/framework';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as actions from '../../src/lib/musicActions';

const GUILD = 'ma-guild';

function fakePlayer(tracks: { title: string; uri?: string }[] = [], current: { title: string; uri?: string } | null = null) {
	const queue = Object.assign([...tracks], { current, add: vi.fn(), shuffle: vi.fn() });
	Object.defineProperty(queue, 'size', { get: () => queue.length });
	const player = {
		data: new Map<string, unknown>(),
		queue,
		volume: 50,
		paused: false,
		playing: true,
		loop: 'none',
		position: 0,
		voiceId: 'v1',
		skip: vi.fn(),
		pause: vi.fn((paused: boolean) => (player.paused = paused)),
		destroy: vi.fn(async () => {}),
		setVolume: vi.fn(async (volume: number) => (player.volume = volume)),
		setLoop: vi.fn(),
		play: vi.fn(async () => {}),
		setVoiceChannel: vi.fn()
	};
	return player;
}

let player: ReturnType<typeof fakePlayer> | undefined;
let kazagumo: { getPlayer: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn>; createPlayer: ReturnType<typeof vi.fn> };
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

beforeEach(() => {
	player = undefined;
	kazagumo = { getPlayer: vi.fn(() => player), search: vi.fn(), createPlayer: vi.fn(async () => player) };
	(container as any).client = { kazagumo };
	(container as any).logger = logger;
	logger.error.mockClear();
});

describe('without a player', () => {
	it.each([
		['skip', () => actions.skip(GUILD)],
		['pause', () => actions.pause(GUILD, true)],
		['stop', () => actions.stop(GUILD)],
		['setVolume', () => actions.setVolume(GUILD, 50)],
		['shuffle', () => actions.shuffle(GUILD)],
		['setLoop', () => actions.setLoop(GUILD, 'queue')],
		['nowPlaying', async () => actions.nowPlaying(GUILD)],
		['queueSummary', async () => actions.queueSummary(GUILD)]
	])('%s reports no_player', async (_name, run) => {
		expect(await run()).toEqual({ ok: false, error: "nothing's playing right now.", code: 'no_player' });
	});

	it('currentVolume is null', () => {
		expect(actions.currentVolume(GUILD)).toBeNull();
	});
});

describe('skip', () => {
	it('skips the current track', async () => {
		player = fakePlayer([{ title: 'a' }]);
		const spliceSpy = vi.spyOn(player.queue, 'splice');
		expect(await actions.skip(GUILD)).toEqual({ ok: true, message: 'skipped.', data: undefined });
		expect(player.skip).toHaveBeenCalled();
		expect(spliceSpy).not.toHaveBeenCalled();
	});

	it('drops count - 1 queued tracks, capped at the queue size', async () => {
		player = fakePlayer([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
		await actions.skip(GUILD, 3);
		expect(player.queue.map((track) => track.title)).toEqual(['c']);

		player = fakePlayer([{ title: 'a' }]);
		await actions.skip(GUILD, 10);
		expect(player.queue).toHaveLength(0);
	});

	it.each([0, -1, 1.5])('rejects a count of %s', async (count) => {
		player = fakePlayer();
		expect(await actions.skip(GUILD, count)).toMatchObject({ ok: false, code: 'bad_input' });
		expect(player.skip).not.toHaveBeenCalled();
	});
});

describe('pause', () => {
	it('pauses and resumes', async () => {
		player = fakePlayer();
		expect(await actions.pause(GUILD, true)).toEqual({ ok: true, message: 'paused.', data: { paused: true } });
		expect(await actions.pause(GUILD, false)).toEqual({ ok: true, message: 'resumed.', data: { paused: false } });
	});
});

describe('stop', () => {
	it('destroys the player', async () => {
		player = fakePlayer();
		expect(await actions.stop(GUILD)).toEqual({ ok: true, message: 'stopped.', data: undefined });
		expect(player.destroy).toHaveBeenCalled();
	});

	it('reports a failed destroy as internal', async () => {
		player = fakePlayer();
		player.destroy.mockRejectedValueOnce(new Error('gone'));
		expect(await actions.stop(GUILD)).toMatchObject({ ok: false, code: 'internal' });
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('gone'));
	});
});

describe('setVolume', () => {
	it.each([0, 101, Number.NaN])('rejects %s', async (volume) => {
		player = fakePlayer();
		expect(await actions.setVolume(GUILD, volume)).toMatchObject({ ok: false, code: 'bad_input' });
		expect(player.setVolume).not.toHaveBeenCalled();
	});

	it('sets the volume', async () => {
		player = fakePlayer();
		expect(await actions.setVolume(GUILD, 100)).toEqual({ ok: true, message: "volume's at 100 now.", data: { volume: 100 } });
		expect(actions.currentVolume(GUILD)).toBe(100);
	});

	it('reports a failed volume change as internal', async () => {
		player = fakePlayer();
		player.setVolume.mockRejectedValueOnce(new Error('nope'));
		expect(await actions.setVolume(GUILD, 10)).toMatchObject({ ok: false, code: 'internal' });
	});
});

describe('shuffle and loop', () => {
	it('shuffles the queue', async () => {
		player = fakePlayer();
		expect(await actions.shuffle(GUILD)).toMatchObject({ ok: true, message: 'shuffled the queue.' });
		expect(player.queue.shuffle).toHaveBeenCalled();
	});

	it('sets a valid loop mode', async () => {
		player = fakePlayer();
		expect(await actions.setLoop(GUILD, 'track')).toEqual({ ok: true, message: "loop mode's track now.", data: { mode: 'track' } });
		expect(player.setLoop).toHaveBeenCalledWith('track');
	});

	it('rejects an unknown loop mode', async () => {
		player = fakePlayer();
		expect(await actions.setLoop(GUILD, 'autoplay' as never)).toMatchObject({ ok: false, code: 'bad_input' });
		expect(player.setLoop).not.toHaveBeenCalled();
	});
});

describe('nowPlaying and queueSummary', () => {
	it('reports no_player when nothing is current', () => {
		player = fakePlayer();
		expect(actions.nowPlaying(GUILD)).toMatchObject({ ok: false, code: 'no_player' });
	});

	it('reports the current track', () => {
		player = fakePlayer([], { title: 'Song', uri: 'https://x/y' });
		expect(actions.nowPlaying(GUILD)).toEqual({ ok: true, message: 'now playing **Song**.', data: { title: 'Song', url: 'https://x/y' } });
	});

	it('lists up to the limit and the total', () => {
		player = fakePlayer([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
		expect(actions.queueSummary(GUILD, 2)).toEqual({ ok: true, message: '3 track(s) queued up.', data: { titles: ['a', 'b'], total: 3 } });
	});
});

describe('play', () => {
	const member = { user: { id: 'u1' } } as never;

	it.each([
		['', 'v1'],
		['song', '']
	])('rejects query %j in channel %j', async (query, channel) => {
		expect(await actions.play(GUILD, member, query, channel)).toMatchObject({ ok: false, code: 'bad_input' });
	});

	it('reports no results', async () => {
		kazagumo.search.mockResolvedValue({ type: 'SEARCH', tracks: [] });
		expect(await actions.play(GUILD, member, 'https://nothing', 'v1')).toMatchObject({ ok: false, code: 'no_results' });
	});

	it('queues the first hit and reports it even after the queue shifts it', async () => {
		player = fakePlayer();
		player.playing = false;
		player.queue.add.mockImplementation((tracks: unknown[]) => tracks.shift());
		kazagumo.search.mockResolvedValue({ type: 'SEARCH', tracks: [{ title: 'First', uri: 'https://x/1' }, { title: 'Second' }] });
		expect(await actions.play(GUILD, member, 'song', 'v1')).toEqual({
			ok: true,
			message: '✅ queued **First**',
			data: { title: 'First', url: 'https://x/1' }
		});
		expect(player.play).toHaveBeenCalled();
	});

	it('creates a player at the guild default volume', async () => {
		kazagumo.search.mockResolvedValue({ type: 'TRACK', tracks: [{ title: 'Only' }] });
		kazagumo.createPlayer.mockImplementation(async () => (player = fakePlayer()));
		expect(await actions.play(GUILD, member, 'song', 'v1')).toMatchObject({ ok: true, data: { title: 'Only', url: null } });
		expect(kazagumo.createPlayer).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, voiceId: 'v1', volume: 25 }));
	});

	it('reports a failed search as internal', async () => {
		kazagumo.search.mockRejectedValue(new Error('lavalink down'));
		expect(await actions.play(GUILD, member, 'song', 'v1')).toMatchObject({ ok: false, code: 'internal' });
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('lavalink down'));
	});
});
