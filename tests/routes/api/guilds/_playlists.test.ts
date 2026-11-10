import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaylist, upsertGrant, type Playlist } from '../../../../src/lib/playlists';
import { loadPlaylist } from '../../../../src/routes/api/guilds/_playlists';
import { unknownMember } from '../../../helpers/discord';

const GUILD = 'playlist-routes-guild';
const OWNER = 'route-owner';
const NONE = { create: false, read: false, update: false, delete: false };

/** Members of the guild; everyone else is a stranger to it. */
const members = new Set([OWNER, 'grantee', 'viewer', 'stranger']);
const guild = {
	id: GUILD,
	members: { fetch: vi.fn(async (id: string) => (members.has(id) ? { id } : Promise.reject(unknownMember()))) }
};
let response: { error: ReturnType<typeof vi.fn> };

beforeEach(() => {
	response = { error: vi.fn() };
	(container as any).client = { guilds: { cache: new Map([[GUILD, guild]]) } };
});

function request(userId: string, playlist: string | number) {
	return { auth: { id: userId }, params: { guild: GUILD, playlist: String(playlist) } } as never;
}

function make(name: string, isPublic: boolean): Playlist {
	const result = createPlaylist(OWNER, { name, isPublic });
	if (!result.ok) throw new Error(result.error);
	return result.playlist;
}

const privateList = make('private', false);
const publicList = make('public', true);
upsertGrant(privateList.id, 'grantee', { ...NONE, update: true }, OWNER);

describe('loadPlaylist', () => {
	it('lets the owner manage', async () => {
		expect(await loadPlaylist(request(OWNER, privateList.id), response as never, 'manage')).toMatchObject({ playlist: { id: privateList.id } });
		expect(response.error).not.toHaveBeenCalled();
	});

	it('lets a grantee use the right they were granted', async () => {
		expect(await loadPlaylist(request('grantee', privateList.id), response as never, 'update')).toMatchObject({ access: { update: true } });
		expect(response.error).not.toHaveBeenCalled();
	});

	it('refuses a grantee a right they were not granted with 403', async () => {
		expect(await loadPlaylist(request('grantee', privateList.id), response as never, 'delete')).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, expect.any(String));
	});

	it('lets a public viewer read but not add with 403', async () => {
		expect(await loadPlaylist(request('viewer', publicList.id), response as never, 'read')).toMatchObject({ access: { read: true } });
		expect(await loadPlaylist(request('viewer', publicList.id), response as never, 'create')).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, expect.any(String));
	});

	it('answers a stranger asking for a private playlist with 404', async () => {
		expect(await loadPlaylist(request('stranger', privateList.id), response as never, 'read')).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.NotFound, expect.any(String));
	});

	it('rejects a non-numeric id with 400', async () => {
		expect(await loadPlaylist(request(OWNER, 'abc'), response as never, 'read')).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.any(String));
	});

	it('rejects a request from outside the guild before touching the playlist', async () => {
		expect(await loadPlaylist(request('outsider', publicList.id), response as never, 'read')).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, 'You are not a member of that server.');
	});
});
