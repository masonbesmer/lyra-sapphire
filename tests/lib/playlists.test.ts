import { describe, expect, it, vi } from 'vitest';
import {
	addTracks,
	authorizePlaylist,
	createPlaylist,
	deletePlaylist,
	getGrant,
	listTracks,
	listVisiblePlaylists,
	listWritablePlaylists,
	MAX_TRACKS_PER_PLAYLIST,
	moveTrack,
	removeTrack,
	setCover,
	sniffImageMime,
	updatePlaylist,
	upsertGrant,
	type GrantFlags,
	type NewTrack,
	type Playlist
} from '../../src/lib/playlists';
import { db } from '../../src/lib/database';
import { unknownMember } from '../helpers/discord';

let ownerSeq = 0;
const nextOwner = () => `owner-${++ownerSeq}`;

const ALL = { read: true, create: true, update: true, delete: true, manage: true };
const NONE: GrantFlags = { create: false, read: false, update: false, delete: false };

function make(ownerId: string, name = 'mix', isPublic = false): Playlist {
	const result = createPlaylist(ownerId, { name, isPublic });
	if (!result.ok) throw new Error(result.error);
	return result.playlist;
}

/** A guild whose member list holds exactly `memberIds`. */
function guildWith(...memberIds: string[]) {
	const fetch = vi.fn(async (id: string) => {
		if (memberIds.includes(id)) return { id };
		throw unknownMember();
	});
	return { members: { fetch } } as never as Parameters<typeof authorizePlaylist>[0] & { members: { fetch: typeof fetch } };
}

function track(title: string): NewTrack {
	return { title, uri: `https://example.com/${title}`, author: 'a', lengthMs: 1000, source: 'youtube', rawJson: '{}' };
}

const titles = (playlistId: number) => listTracks(playlistId).map((t) => `${t.position}:${t.title}`);

describe('authorizePlaylist', () => {
	it('gives the owner every right without asking the guild about anyone', async () => {
		const owner = nextOwner();
		const playlist = make(owner);
		const guild = guildWith();
		expect(await authorizePlaylist(guild, owner, playlist.id, 'manage')).toEqual({ ok: true, playlist, access: ALL });
		expect(guild.members.fetch).not.toHaveBeenCalled();
	});

	it('gives a granted user read plus exactly the granted rights', async () => {
		const owner = nextOwner();
		const playlist = make(owner);
		upsertGrant(playlist.id, 'grantee', { ...NONE, create: true }, owner);
		const guild = guildWith();

		const added = await authorizePlaylist(guild, 'grantee', playlist.id, 'create');
		expect(added).toMatchObject({ ok: true, access: { read: true, create: true, update: false, delete: false, manage: false } });
		expect(await authorizePlaylist(guild, 'grantee', playlist.id, 'delete')).toMatchObject({ ok: false, reason: 'forbidden' });
		expect(await authorizePlaylist(guild, 'grantee', playlist.id, 'manage')).toMatchObject({ ok: false, reason: 'forbidden' });
		expect(guild.members.fetch).not.toHaveBeenCalled();
	});

	it('scopes a grant to its own playlist', async () => {
		const owner = nextOwner();
		const granted = make(owner, 'a');
		const other = make(owner, 'b');
		upsertGrant(granted.id, 'grantee', { ...NONE, delete: true }, owner);

		expect(await authorizePlaylist(guildWith(), 'grantee', granted.id, 'delete')).toMatchObject({ ok: true });
		expect(await authorizePlaylist(guildWith(), 'grantee', other.id, 'read')).toEqual({ ok: false, reason: 'not_found' });
	});

	it('lets a public viewer in a guild shared with the owner read and nothing more', async () => {
		const owner = nextOwner();
		const playlist = make(owner, 'pub', true);
		const guild = guildWith(owner, 'viewer');

		expect(await authorizePlaylist(guild, 'viewer', playlist.id, 'read')).toMatchObject({
			ok: true,
			access: { read: true, create: false, update: false, delete: false, manage: false }
		});
		for (const need of ['create', 'update', 'delete', 'manage'] as const) {
			expect(await authorizePlaylist(guild, 'viewer', playlist.id, need)).toMatchObject({ ok: false, reason: 'forbidden' });
		}
	});

	it('hides a public playlist from a guild its owner is not in', async () => {
		const owner = nextOwner();
		const playlist = make(owner, 'pub', true);
		expect(await authorizePlaylist(guildWith('viewer'), 'viewer', playlist.id, 'read')).toEqual({ ok: false, reason: 'not_found' });
	});

	it('denies a stranger a private playlist as if it did not exist', async () => {
		const owner = nextOwner();
		const playlist = make(owner);
		expect(await authorizePlaylist(guildWith(owner, 'stranger'), 'stranger', playlist.id, 'read')).toEqual({ ok: false, reason: 'not_found' });
		expect(await authorizePlaylist(guildWith(owner), 'stranger', 999_999, 'read')).toEqual({ ok: false, reason: 'not_found' });
	});

	it('fails loudly instead of hiding a public playlist when Discord cannot be reached', async () => {
		const playlist = make(nextOwner(), 'pub', true);
		const outage = { members: { fetch: vi.fn(async () => Promise.reject(new Error('503 Service Unavailable'))) } } as never;
		await expect(authorizePlaylist(outage, 'viewer', playlist.id, 'read')).rejects.toThrow('503');
		await expect(listVisiblePlaylists(outage, 'viewer')).rejects.toThrow('503');
	});
});

describe('createPlaylist / updatePlaylist', () => {
	it('rejects a duplicate name per owner, case-insensitively, but not across owners', () => {
		const owner = nextOwner();
		make(owner, 'Road Trip');
		expect(createPlaylist(owner, { name: 'road trip' })).toEqual({ ok: false, error: 'duplicate' });
		expect(createPlaylist(nextOwner(), { name: 'road trip' }).ok).toBe(true);
	});

	it.each(['', '   ', 'a\nb', 'x'.repeat(101)])('rejects the name %j', (name) => {
		expect(createPlaylist(nextOwner(), { name })).toEqual({ ok: false, error: 'invalid_name' });
	});

	it('renames, refusing a name the owner already uses', () => {
		const owner = nextOwner();
		make(owner, 'one');
		const two = make(owner, 'two');
		expect(updatePlaylist(two.id, { name: 'ONE' })).toEqual({ ok: false, error: 'duplicate' });
		expect(updatePlaylist(two.id, { name: ' three ', isPublic: true })).toMatchObject({ ok: true, playlist: { name: 'three', isPublic: true } });
	});
});

describe('tracks', () => {
	it('appends densely and in order', () => {
		const playlist = make(nextOwner());
		addTracks(playlist.id, [track('a'), track('b')], 'u');
		addTracks(playlist.id, [track('c')], 'u');
		expect(titles(playlist.id)).toEqual(['0:a', '1:b', '2:c']);
	});

	it('refuses to grow past the cap', () => {
		const playlist = make(nextOwner());
		addTracks(
			playlist.id,
			Array.from({ length: MAX_TRACKS_PER_PLAYLIST }, (_, i) => track(String(i))),
			'u'
		);
		expect(addTracks(playlist.id, [track('over')], 'u')).toEqual({ ok: false, error: 'full' });
		expect(listTracks(playlist.id)).toHaveLength(MAX_TRACKS_PER_PLAYLIST);
	});

	it('re-compacts positions after a removal', () => {
		const playlist = make(nextOwner());
		addTracks(playlist.id, [track('a'), track('b'), track('c')], 'u');
		expect(removeTrack(playlist.id, listTracks(playlist.id)[0].id)).toBe(true);
		expect(titles(playlist.id)).toEqual(['0:b', '1:c']);
	});

	it('will not remove a track through another playlist', () => {
		const a = make(nextOwner());
		const b = make(nextOwner());
		addTracks(a.id, [track('a')], 'u');
		expect(removeTrack(b.id, listTracks(a.id)[0].id)).toBe(false);
		expect(listTracks(a.id)).toHaveLength(1);
	});

	it('moves front to back and back to front', () => {
		const playlist = make(nextOwner());
		addTracks(playlist.id, [track('a'), track('b'), track('c'), track('d')], 'u');
		expect(moveTrack(playlist.id, 0, 3)).toBe(true);
		expect(titles(playlist.id)).toEqual(['0:b', '1:c', '2:d', '3:a']);
		expect(moveTrack(playlist.id, 3, 0)).toBe(true);
		expect(titles(playlist.id)).toEqual(['0:a', '1:b', '2:c', '3:d']);
		expect(moveTrack(playlist.id, 0, 4)).toBe(false);
	});
});

describe('deletePlaylist', () => {
	it('leaves no tracks or grants behind', () => {
		const owner = nextOwner();
		const playlist = make(owner);
		addTracks(playlist.id, [track('a')], owner);
		upsertGrant(playlist.id, 'grantee', { ...NONE, read: true }, owner);
		deletePlaylist(playlist.id);

		expect(db.prepare(`SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?`).get(playlist.id)).toEqual({ n: 0 });
		expect(getGrant(playlist.id, 'grantee')).toBeNull();
	});
});

describe('listing', () => {
	it('puts each playlist in one section and hides publics whose owner is elsewhere', async () => {
		const viewer = nextOwner();
		const here = nextOwner();
		const away = nextOwner();
		const mine = make(viewer, 'mine', true);
		const sharedPublic = make(here, 'shared', true);
		const publicHere = make(here, 'public');
		updatePlaylist(publicHere.id, { isPublic: true });
		const publicAway = make(away, 'away', true);
		upsertGrant(sharedPublic.id, viewer, { ...NONE, read: true }, here);

		const lists = await listVisiblePlaylists(guildWith(viewer, here), viewer);
		const ids = (section: { playlist: Playlist }[]) => section.map(({ playlist }) => playlist.id);
		expect(ids(lists.owned)).toEqual([mine.id]);
		expect(ids(lists.shared)).toEqual([sharedPublic.id]);
		expect(ids(lists.public)).toContain(publicHere.id);
		expect(ids(lists.public)).not.toContain(sharedPublic.id);
		expect(ids(lists.public)).not.toContain(publicAway.id);
	});

	it('offers only playlists the user may add to', () => {
		const user = nextOwner();
		const other = nextOwner();
		const own = make(user, 'own');
		const writable = make(other, 'writable');
		const readOnly = make(other, 'read-only');
		upsertGrant(writable.id, user, { ...NONE, create: true }, other);
		upsertGrant(readOnly.id, user, { ...NONE, read: true }, other);

		expect(listWritablePlaylists(user, 'create').map((p) => p.id)).toEqual([own.id, writable.id]);
	});
});

describe('covers', () => {
	it.each([
		['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]],
		['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
		['image/gif', [...Buffer.from('GIF89a')]],
		['image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]]
	])('recognises %s', (mime, bytes) => {
		expect(sniffImageMime(Uint8Array.from(bytes))).toBe(mime);
	});

	it.each([
		['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
		['noise', Buffer.from([1, 2, 3, 4])],
		['empty', Buffer.alloc(0)]
	])('refuses %s', (_name, bytes) => {
		expect(sniffImageMime(bytes)).toBeNull();
	});

	it('keeps cover bytes out of listings but versions the playlist', () => {
		const owner = nextOwner();
		const playlist = make(owner);
		setCover(playlist.id, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
		const [listed] = listWritablePlaylists(owner, 'update');
		expect(listed).toMatchObject({ coverMime: 'image/jpeg', coverUpdatedAt: expect.any(String) });
		expect(listed).not.toHaveProperty('cover_image');
	});
});
