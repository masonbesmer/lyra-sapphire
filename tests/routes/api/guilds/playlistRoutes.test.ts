import { container } from '@sapphire/framework';
import { HttpCodes, type Route } from '@sapphire/plugin-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBCOMMAND_RIGHTS } from '../../../../src/commands/music/playlist';
import {
	addTracks,
	createPlaylist,
	getCover,
	getPlaylist,
	MAX_COVER_BYTES,
	upsertGrant,
	type Playlist,
	type PlaylistRight
} from '../../../../src/lib/playlists';
import { UserRoute as DeletePlaylist } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist].delete';
import { UserRoute as GetPlaylist } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist].get';
import { UserRoute as PatchPlaylist } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist].patch';
import { UserRoute as DeleteCover } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/cover.delete';
import { UserRoute as GetCover } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/cover.get';
import { UserRoute as PostCover } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/cover.post';
import { UserRoute as Enqueue } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/enqueue.post';
import { UserRoute as RevokeGrant } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/grants/[user].delete';
import { UserRoute as PostGrant } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/grants.post';
import { UserRoute as Reorder } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/reorder.post';
import { UserRoute as RemoveTrack } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/tracks/[track].delete';
import { UserRoute as AddTracks } from '../../../../src/routes/api/guilds/[guild]/playlists/[playlist]/tracks.post';
import { unknownMember } from '../../../helpers/discord';

const GUILD = 'playlist-route-rights-guild';
const OWNER = 'rights-owner';
const RIGHTS = ['create', 'read', 'update', 'delete'] as const;
type Grantable = (typeof RIGHTS)[number];

const members = new Set([OWNER, 'grantee', 'stranger']);
const guild = {
	id: GUILD,
	members: { fetch: vi.fn(async (id: string) => (members.has(id) ? { id } : Promise.reject(unknownMember()))) }
};

beforeEach(() => {
	(container as any).client = { guilds: { cache: new Map([[GUILD, guild]]) }, users: { cache: new Map(), fetch: async () => null } };
});

let seq = 0;
function playlist(isPublic = false): Playlist {
	const result = createPlaylist(OWNER, { name: `rights-${++seq}`, isPublic });
	if (!result.ok) throw new Error(result.error);
	addTracks(result.playlist.id, [{ title: 't', uri: null, author: null, lengthMs: 1, source: 'youtube', rawJson: '{}' }], OWNER);
	return result.playlist;
}

function grant(playlistId: number, rights: readonly Grantable[]) {
	upsertGrant(
		playlistId,
		'grantee',
		Object.fromEntries(RIGHTS.map((right) => [right, rights.includes(right)])) as Record<Grantable, boolean>,
		OWNER
	);
}

/** Runs a route's handler directly; none of them read `this`, so no router has to be built. */
async function call(
	RouteClass: abstract new (...args: never[]) => Route,
	userId: string,
	playlistId: number,
	body: unknown = {},
	upload: Uint8Array = new Uint8Array()
) {
	const response = { error: vi.fn(), json: vi.fn(), image: vi.fn(), setHeader: vi.fn() };
	const request = {
		auth: { id: userId },
		params: { guild: GUILD, playlist: String(playlistId), track: '999999', user: 'nobody' },
		readBody: async () => body,
		readBodyArrayBuffer: async () => upload.slice().buffer
	};
	await (Object.create(RouteClass.prototype) as Route).run(request as never, response as never);
	return response;
}

const refusedWith = (response: { error: ReturnType<typeof vi.fn> }, code: HttpCodes) => response.error.mock.calls.some(([status]) => status === code);

/** The right each route demands, kept apart from the routes so a weakened gate fails here. */
const ROUTES: [string, abstract new (...args: never[]) => Route, PlaylistRight][] = [
	['GET /:id', GetPlaylist, 'read'],
	['GET /:id/cover', GetCover, 'read'],
	['POST /:id/enqueue', Enqueue, 'read'],
	['POST /:id/tracks', AddTracks, 'create'],
	['POST /:id/reorder', Reorder, 'update'],
	['POST /:id/cover', PostCover, 'update'],
	['DELETE /:id/cover', DeleteCover, 'update'],
	['DELETE /:id/tracks/:track', RemoveTrack, 'delete'],
	['DELETE /:id', DeletePlaylist, 'manage'],
	['POST /:id/grants', PostGrant, 'manage'],
	['DELETE /:id/grants/:user', RevokeGrant, 'manage']
];

describe('playlist routes demand the right their action needs', () => {
	it.each(ROUTES)('%s lets a holder of the right past the gate', async (_name, RouteClass, need) => {
		const target = playlist();
		const holder = need === 'manage' ? OWNER : 'grantee';
		if (need !== 'manage') grant(target.id, [need]);
		const response = await call(RouteClass, holder, target.id);
		expect(refusedWith(response, HttpCodes.Forbidden)).toBe(false);
		expect(response.error).not.toHaveBeenCalledWith(HttpCodes.NotFound, "That playlist doesn't exist or you can't see it.");
	});

	it.each(ROUTES.filter(([, , need]) => need !== 'read'))('%s refuses a grantee holding every other right', async (_name, RouteClass, need) => {
		const target = playlist();
		grant(
			target.id,
			RIGHTS.filter((right) => right !== need)
		);
		expect(refusedWith(await call(RouteClass, 'grantee', target.id), HttpCodes.Forbidden)).toBe(true);
		expect(getPlaylist(target.id)).toMatchObject({ trackCount: 1 });
	});

	it.each(ROUTES.filter(([, , need]) => need !== 'read'))('%s refuses a public viewer', async (_name, RouteClass) => {
		const target = playlist(true);
		expect(refusedWith(await call(RouteClass, 'stranger', target.id), HttpCodes.Forbidden)).toBe(true);
	});

	it.each(ROUTES)('%s hides a private playlist from a stranger', async (_name, RouteClass) => {
		const target = playlist();
		expect(refusedWith(await call(RouteClass, 'stranger', target.id), HttpCodes.NotFound)).toBe(true);
		expect(getPlaylist(target.id)).toMatchObject({ trackCount: 1 });
	});
});

describe('PATCH /:id gates each field by its own right', () => {
	it('lets an update grantee rename but not publish', async () => {
		const target = playlist();
		grant(target.id, ['update']);

		expect(refusedWith(await call(PatchPlaylist, 'grantee', target.id, { isPublic: true }), HttpCodes.Forbidden)).toBe(true);
		expect(getPlaylist(target.id)?.isPublic).toBe(false);

		const renamed = await call(PatchPlaylist, 'grantee', target.id, { name: `${target.name}-renamed` });
		expect(renamed.error).not.toHaveBeenCalled();
		expect(getPlaylist(target.id)?.name).toBe(`${target.name}-renamed`);
	});

	it('refuses a rename from a grantee without update', async () => {
		const target = playlist();
		grant(target.id, ['create', 'read', 'delete']);
		expect(refusedWith(await call(PatchPlaylist, 'grantee', target.id, { name: 'taken over' }), HttpCodes.Forbidden)).toBe(true);
		expect(getPlaylist(target.id)?.name).toBe(target.name);
	});

	it('lets the owner publish', async () => {
		const target = playlist();
		expect((await call(PatchPlaylist, OWNER, target.id, { isPublic: true })).error).not.toHaveBeenCalled();
		expect(getPlaylist(target.id)?.isPublic).toBe(true);
	});
});

describe('POST /:id/cover stores only small raster images', () => {
	const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
	const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

	it('stores a PNG under the type its bytes show', async () => {
		const target = playlist();
		expect((await call(PostCover, OWNER, target.id, {}, PNG)).error).not.toHaveBeenCalled();
		expect(getCover(target.id)).toMatchObject({ mime: 'image/png' });
	});

	it('refuses an SVG', async () => {
		const target = playlist();
		expect(refusedWith(await call(PostCover, OWNER, target.id, {}, SVG), HttpCodes.UnsupportedMediaType)).toBe(true);
		expect(getCover(target.id)).toBeNull();
	});

	it('refuses an image over the size limit', async () => {
		const target = playlist();
		const oversize = new Uint8Array(MAX_COVER_BYTES + 1);
		oversize.set(PNG);
		expect(refusedWith(await call(PostCover, OWNER, target.id, {}, oversize), HttpCodes.PayloadTooLarge)).toBe(true);
		expect(getCover(target.id)).toBeNull();
	});
});

describe('GET /:id shows who it is shared with only to the owner', () => {
	const grantsSent = (response: { json: ReturnType<typeof vi.fn> }) => response.json.mock.calls[0][0].grants as { userId: string }[];

	it('lists the grants for the owner', async () => {
		const target = playlist();
		grant(target.id, ['read']);
		expect(grantsSent(await call(GetPlaylist, OWNER, target.id)).map((g) => g.userId)).toEqual(['grantee']);
	});

	it('sends a grantee no grants, even one with every right', async () => {
		const target = playlist();
		grant(target.id, RIGHTS);
		expect(grantsSent(await call(GetPlaylist, 'grantee', target.id))).toEqual([]);
	});
});

describe('/playlist subcommands', () => {
	it('gate each subcommand with the right its API route needs', () => {
		expect(SUBCOMMAND_RIGHTS).toEqual({
			delete: 'manage',
			add: 'create',
			'add-current': 'create',
			remove: 'delete',
			move: 'update',
			view: 'read',
			play: 'read'
		});
	});
});
