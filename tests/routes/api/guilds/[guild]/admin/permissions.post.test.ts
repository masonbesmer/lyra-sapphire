import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfigAudit } from '../../../../../../src/lib/audit';
import { getCommandPermissions, setCommandPermission } from '../../../../../../src/lib/config';
import { UserRoute } from '../../../../../../src/routes/api/guilds/[guild]/admin/permissions.post';

const GUILD = 'perm-route-guild';
const guild = { id: GUILD, roles: { cache: new Map([['mods', {}]]) } };
const member = { id: 'admin', user: { username: 'admin' } };
let body: unknown;

vi.mock('../../../../../../src/routes/api/guilds/_helpers', () => ({
	resolveGuild: async () => ({ guild, member }),
	requireAdmin: () => true,
	readJsonBody: async () => body
}));

const commands = [{ name: 'keyword', parsedSubcommandMappings: [{ name: 'add', messageRun: 'a' }] }, { name: 'permissions' }];

beforeEach(() => {
	(container as any).stores = { get: () => new Map(commands.map((command) => [command.name, command])) };
});

async function post(payload: unknown) {
	body = payload;
	const response = { json: vi.fn(), error: vi.fn() };
	const route = Object.create(UserRoute.prototype) as UserRoute;
	await route.run({ params: { guild: GUILD } } as never, response as never);
	return response;
}

describe('POST admin/permissions', () => {
	it('refuses to gate /permissions or its subcommands', async () => {
		for (const command_name of ['permissions', 'Permissions set']) {
			const response = await post({ action: 'set', command_name, required_role_id: 'mods' });
			expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.stringContaining('Administrator'));
		}
		expect(getCommandPermissions(GUILD)).toEqual([]);
	});

	it('refuses a path that is not a command or subcommand', async () => {
		const response = await post({ action: 'set', command_name: 'keyword nope', required_role_id: 'mods' });
		expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.any(String));
		expect(getCommandPermissions(GUILD)).toEqual([]);
	});

	it('stores and audits the normalized path', async () => {
		const response = await post({ action: 'set', command_name: '  /Keyword   ADD ', required_role_id: 'mods' });
		expect(response.error).not.toHaveBeenCalled();
		expect(getCommandPermissions(GUILD)).toEqual([{ command_name: 'keyword add', required_role_id: 'mods' }]);
		expect(getConfigAudit(GUILD, { section: 'permissions' })[0]).toMatchObject({ setting: 'keyword add', new_value: 'mods' });
	});

	it('removes a stored row even when its path is no longer a target', async () => {
		setCommandPermission(GUILD, 'typo path', 'mods');
		const response = await post({ action: 'remove', command_name: 'Typo Path' });
		expect(response.error).not.toHaveBeenCalled();
		expect(getCommandPermissions(GUILD).map((perm) => perm.command_name)).not.toContain('typo path');
	});
});
