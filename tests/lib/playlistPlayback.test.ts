import { container } from '@sapphire/framework';
import { KazagumoTrack } from 'kazagumo';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setMusicConfig } from '../../src/lib/config';
import { playPlaylist, toKazagumoTrack, toNewTrack, type PlayPlaylistOptions } from '../../src/lib/playlistPlayback';
import { addTracks, createPlaylist, listTracks, MAX_TRACKS_PER_PLAY, type Playlist } from '../../src/lib/playlists';

const GUILD = 'playback-guild';
const DJ_GUILD = 'playback-dj-guild';

function rawTrack(id: string) {
	return {
		encoded: `encoded-${id}`,
		info: {
			identifier: id,
			isSeekable: true,
			author: 'artist',
			length: 1000,
			isStream: false,
			position: 0,
			title: `title-${id}`,
			uri: `https://www.youtube.com/watch?v=${id}`,
			sourceName: 'youtube',
			artworkUrl: null,
			isrc: null
		},
		pluginInfo: {}
	};
}

function fakePlayer() {
	const added: KazagumoTrack[] = [];
	return {
		added,
		data: new Map<string, unknown>(),
		queue: { add: vi.fn((tracks: KazagumoTrack[]) => added.push(...tracks)), shuffle: vi.fn() },
		playing: true,
		paused: false,
		voiceId: 'voice',
		play: vi.fn(async () => {}),
		setLoop: vi.fn(),
		setVoiceChannel: vi.fn()
	};
}

let player: ReturnType<typeof fakePlayer>;
let seq = 0;

beforeEach(() => {
	player = fakePlayer();
	(container as any).client = { kazagumo: { getPlayer: () => player, KazagumoOptions: {} } };
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

function playlistWith(ids: string[]): Playlist {
	const result = createPlaylist(`owner-${++seq}`, { name: 'list' });
	if (!result.ok) throw new Error(result.error);
	addTracks(
		result.playlist.id,
		ids.map((id) => toNewTrack(new KazagumoTrack(rawTrack(id) as never, null))),
		'owner'
	);
	return result.playlist;
}

function member(isDJ: boolean) {
	return {
		user: { id: 'listener' },
		permissions: { has: () => false },
		guild: { roles: { cache: new Map([['dj', {}]]) } },
		roles: { cache: new Map(isDJ ? [['dj', {}]] : []) },
		voice: { channel: null }
	} as never;
}

function options(playlist: Playlist, overrides: Partial<PlayPlaylistOptions> = {}): PlayPlaylistOptions {
	return {
		guildId: GUILD,
		member: member(true),
		voiceChannelId: 'voice',
		textChannelId: 'text',
		interaction: null,
		playlist,
		shuffle: false,
		loop: false,
		repeat: 1,
		...overrides
	};
}

const queuedIds = () => player.added.map((t) => t.identifier);

describe('playPlaylist', () => {
	it('queues the stored tracks in order without searching again', async () => {
		const playlist = playlistWith(['a', 'b']);
		const result = await playPlaylist(options(playlist));
		expect(result).toEqual({ ok: true, message: '✅ queued playlist **list** (2 tracks)', data: { queued: 2 } });
		expect(queuedIds()).toEqual(['a', 'b']);
		expect(player.added[0].track).toBe('encoded-a');
	});

	it('queues the playlist once per repeat', async () => {
		const result = await playPlaylist(options(playlistWith(['a', 'b']), { repeat: 3 }));
		expect(result).toMatchObject({ ok: true, data: { queued: 6 } });
		expect(queuedIds()).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
	});

	it('shuffles only its own tracks, never the shared queue', async () => {
		const ids = Array.from({ length: 20 }, (_, i) => String(i));
		await playPlaylist(options(playlistWith(ids), { shuffle: true, repeat: 2 }));
		expect(player.queue.shuffle).not.toHaveBeenCalled();
		expect(queuedIds().slice(0, 20).sort()).toEqual([...ids].sort());
		expect(queuedIds().slice(20).sort()).toEqual([...ids].sort());
	});

	it('turns on queue loop for a DJ', async () => {
		await playPlaylist(options(playlistWith(['a']), { loop: true }));
		expect(player.setLoop).toHaveBeenCalledWith('queue');
	});

	it('refuses loop to a non-DJ and queues nothing', async () => {
		setMusicConfig({ guild_id: DJ_GUILD, dj_role_id: 'dj' });
		const result = await playPlaylist(options(playlistWith(['a']), { guildId: DJ_GUILD, member: member(false), loop: true }));
		expect(result).toMatchObject({ ok: false, code: 'bad_input' });
		expect(player.queue.add).not.toHaveBeenCalled();
		expect(player.setLoop).not.toHaveBeenCalled();
	});

	it.each([0, 11, 1.5])('rejects a repeat of %s', async (repeat) => {
		expect(await playPlaylist(options(playlistWith(['a']), { repeat }))).toMatchObject({ ok: false, code: 'bad_input' });
	});

	it('refuses to queue more than the per-play cap', async () => {
		const playlist = playlistWith(Array.from({ length: MAX_TRACKS_PER_PLAY / 10 + 1 }, (_, i) => String(i)));
		expect(await playPlaylist(options(playlist, { repeat: 10 }))).toMatchObject({ ok: false, code: 'bad_input' });
		expect(player.queue.add).not.toHaveBeenCalled();
	});

	it('refuses an empty playlist', async () => {
		expect(await playPlaylist(options(playlistWith([])))).toEqual({ ok: false, error: 'that playlist is empty.', code: 'bad_input' });
	});
});

describe('stored tracks', () => {
	it('round-trip the encoded Lavalink track', () => {
		const playlist = playlistWith(['xyz']);
		const restored = toKazagumoTrack(listTracks(playlist.id)[0], { id: 'u' } as never, { KazagumoOptions: {} } as never);
		expect(restored).toMatchObject({
			track: 'encoded-xyz',
			title: 'title-xyz',
			uri: 'https://www.youtube.com/watch?v=xyz',
			requester: { id: 'u' }
		});
	});

	it('keep a title corrected after Lavalink answered', () => {
		const upload = new KazagumoTrack(rawTrack('upload') as never, null);
		upload.title = 'holiday.mp3';
		const result = createPlaylist(`owner-${++seq}`, { name: 'uploads' });
		if (!result.ok) throw new Error(result.error);
		addTracks(result.playlist.id, [toNewTrack(upload)], 'u');

		const restored = toKazagumoTrack(listTracks(result.playlist.id)[0], { id: 'u' } as never, { KazagumoOptions: {} } as never);
		expect(restored.title).toBe('holiday.mp3');
	});
});
