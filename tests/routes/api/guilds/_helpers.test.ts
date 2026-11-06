import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setMusicConfig } from '../../../../src/lib/config';
import { getOrCreateSlug } from '../../../../src/lib/slug';
import { getPlayer, readJsonBody, requireAdmin, requireDJ, resolveGuild } from '../../../../src/routes/api/guilds/_helpers';

const GUILD = 'helpers-guild';
const member = { id: 'u1' };
const guild = { id: GUILD, members: { fetch: vi.fn(async () => member) } };
let response: { error: ReturnType<typeof vi.fn> };

beforeEach(() => {
	response = { error: vi.fn() };
	guild.members.fetch.mockImplementation(async () => member);
	(container as any).client = { guilds: { cache: new Map([[GUILD, guild]]) }, kazagumo: { getPlayer: () => undefined } };
});

function request(auth: { id: string } | null = { id: 'u1' }) {
	return { auth } as never;
}

describe('resolveGuild', () => {
	it('rejects a request without a session', async () => {
		expect(await resolveGuild(request(null), response as never, GUILD)).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Unauthorized, expect.any(String));
	});

	it('rejects a guild the bot is not in', async () => {
		expect(await resolveGuild(request(), response as never, 'unknown-slug')).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.NotFound, expect.any(String));
	});

	it('rejects a user who is not a member', async () => {
		guild.members.fetch.mockRejectedValueOnce(new Error('Unknown Member'));
		expect(await resolveGuild(request(), response as never, GUILD)).toBeNull();
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, expect.any(String));
	});

	it('resolves by guild id', async () => {
		expect(await resolveGuild(request(), response as never, GUILD)).toEqual({ guild, member });
		expect(guild.members.fetch).toHaveBeenCalledWith('u1');
		expect(response.error).not.toHaveBeenCalled();
	});

	it('resolves by slug', async () => {
		const slug = getOrCreateSlug(GUILD, 'Helpers Guild');
		expect(await resolveGuild(request(), response as never, slug)).toEqual({ guild, member });
	});
});

describe('requireDJ', () => {
	setMusicConfig({ guild_id: GUILD, dj_role_id: 'dj' });

	function djMember(hasRole: boolean) {
		return {
			permissions: { has: () => false },
			guild: { roles: { cache: new Map([['dj', {}]]) } },
			roles: { cache: new Map(hasRole ? [['dj', {}]] : []) },
			voice: { channel: null }
		} as never;
	}

	it('allows a DJ', () => {
		expect(requireDJ(response as never, guild as never, djMember(true))).toBe(true);
		expect(response.error).not.toHaveBeenCalled();
	});

	it('refuses a non-DJ with 403', () => {
		expect(requireDJ(response as never, guild as never, djMember(false))).toBe(false);
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, 'That action needs the DJ role.');
	});
});

describe('requireAdmin', () => {
	function adminMember(permissions: string[]) {
		return { permissions: { has: (permission: string) => permissions.includes(permission) } } as never;
	}

	it.each([['ManageGuild'], ['Administrator']])('allows %s', (permission) => {
		expect(requireAdmin(response as never, adminMember([permission]))).toBe(true);
	});

	it('refuses everyone else with 403', () => {
		expect(requireAdmin(response as never, adminMember([]))).toBe(false);
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, 'That needs Manage Server.');
	});
});

describe('readJsonBody', () => {
	it('returns the parsed body', async () => {
		expect(await readJsonBody({ readBody: async () => ({ a: 1 }) } as never)).toEqual({ a: 1 });
	});

	it('returns null when the body cannot be read', async () => {
		expect(await readJsonBody({ readBody: async () => Promise.reject(new Error('bad json')) } as never)).toBeNull();
	});
});

describe('getPlayer', () => {
	it('returns null when the guild has no player', () => {
		expect(getPlayer(GUILD)).toBeNull();
	});
});
