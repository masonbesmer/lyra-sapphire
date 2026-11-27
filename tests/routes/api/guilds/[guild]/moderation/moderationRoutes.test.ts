import { HttpCodes } from '@sapphire/plugin-api';
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAntiRaidConfig } from '../../../../../../src/lib/antiRaid';
import { getConfigAudit } from '../../../../../../src/lib/audit';
import { getRule } from '../../../../../../src/lib/automod';
import { setCommandPermission } from '../../../../../../src/lib/config';
import { getLogRoutes } from '../../../../../../src/lib/eventLog';
import { createCase } from '../../../../../../src/lib/moderation';
import { UserRoute as Overview } from '../../../../../../src/routes/api/guilds/[guild]/moderation.get';
import { UserRoute as AntiRaid } from '../../../../../../src/routes/api/guilds/[guild]/moderation/antiraid.patch';
import { UserRoute as Automod } from '../../../../../../src/routes/api/guilds/[guild]/moderation/automod.patch';
import { UserRoute as Cases } from '../../../../../../src/routes/api/guilds/[guild]/moderation/cases.get';
import { UserRoute as Logging } from '../../../../../../src/routes/api/guilds/[guild]/moderation/logging.patch';
import { guildMember } from '../../../../../helpers/discord';

const GUILD = 'mod-route-guild';
const LOG_CHANNEL = 'chan-log';
const QUARANTINE = 'role-quarantine';

const me = {
	roles: { highest: { position: 10 } },
	permissions: new PermissionsBitField(PermissionFlagsBits.Administrator)
};
const guild = {
	id: GUILD,
	members: { me, fetchMe: async () => me },
	roles: {
		cache: new Map([[QUARANTINE, { id: QUARANTINE, name: 'quarantine', position: 2, managed: false }]])
	},
	channels: {
		cache: new Map([
			[
				LOG_CHANNEL,
				{
					id: LOG_CHANNEL,
					name: 'logs',
					type: ChannelType.GuildText,
					position: 0,
					isSendable: () => true,
					permissionsFor: () => ({ has: () => true })
				}
			]
		])
	}
};

let member = staff(PermissionFlagsBits.Administrator);
let body: unknown;

function staff(permissions: bigint, roleIds: string[] = []) {
	return guildMember({
		id: 'mod',
		user: { username: 'mod' },
		guild: { id: GUILD },
		permissions: new PermissionsBitField(permissions),
		roles: { cache: new Map(roleIds.map((id) => [id, {}])) }
	});
}

vi.mock('../../../../../../src/routes/api/guilds/_helpers', () => ({
	resolveGuild: async () => ({ guild, member }),
	readJsonBody: async () => body
}));

async function call(Route: { prototype: object }, payload?: unknown, query: Record<string, string> = {}) {
	body = payload;
	const response = { json: vi.fn(), error: vi.fn() };
	const route = Object.create(Route.prototype) as { run(request: never, response: never): Promise<unknown> };
	await route.run({ params: { guild: GUILD }, query } as never, response as never);
	return response;
}

beforeEach(() => {
	member = staff(PermissionFlagsBits.Administrator);
});

describe('GET moderation (overview)', () => {
	it('refuses members with no staff permission', async () => {
		member = staff(0n);
		const response = await call(Overview);
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, expect.any(String));
	});

	it('leaves out the panels a moderator cannot use', async () => {
		member = staff(PermissionFlagsBits.ModerateMembers);
		const response = await call(Overview);
		const payload = response.json.mock.calls[0][0];
		expect(payload.access).toMatchObject({ cases: true, members: true, automod: false, roles: false });
		expect(payload.automod).toBeNull();
		expect(payload.antiraid).toBeNull();
		expect(payload.text_channels).toEqual([{ id: LOG_CHANNEL, name: 'logs' }]);
	});
});

describe('GET moderation/cases', () => {
	it('needs Moderate Members', async () => {
		member = staff(PermissionFlagsBits.ManageRoles);
		const response = await call(Cases);
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, expect.stringContaining('Moderate Members'));
	});

	it('searches the guild’s cases', async () => {
		createCase({ guildId: GUILD, action: 'warn', targetId: '444444444444444444', targetTag: 'carol', moderatorId: 'mod', reason: 'rude' });
		const response = await call(Cases, undefined, { q: 'carol', action: 'warn' });
		expect(response.json.mock.calls[0][0]).toMatchObject({ total: 1, cases: [{ target_tag: 'carol' }] });
	});
});

describe('PATCH moderation/automod', () => {
	it('saves a filter and audits it as a dashboard change', async () => {
		const response = await call(Automod, { rule: 'caps', enabled: true, limit: 80 });
		expect(response.error).not.toHaveBeenCalled();
		expect(getRule(GUILD, 'caps')).toMatchObject({ enabled: true, settings: { limit: 80 } });
		expect(getConfigAudit(GUILD, { section: 'moderation' })).toEqual(
			expect.arrayContaining([expect.objectContaining({ setting: 'automod.caps.limit', new_value: '80', source: 'dashboard' })])
		);
	});

	it('rejects an out-of-range limit without saving', async () => {
		const response = await call(Automod, { rule: 'emoji', enabled: true, limit: 0 });
		expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.stringContaining('limit'));
		expect(getRule(GUILD, 'emoji').enabled).toBe(false);
	});

	it('honours a /permissions gate on the matching subcommand', async () => {
		setCommandPermission(GUILD, 'automod list', 'role-lists');
		const response = await call(Automod, { rule: 'words', list: ['spam'] });
		expect(response.error).toHaveBeenCalledWith(HttpCodes.Forbidden, expect.any(String));
		member = staff(PermissionFlagsBits.Administrator, ['role-lists']);
		const allowed = await call(Automod, { rule: 'words', list: ['spam'] });
		expect(allowed.error).not.toHaveBeenCalled();
		expect(getRule(GUILD, 'words').settings.words).toEqual(['spam']);
	});
});

describe('PATCH moderation/antiraid', () => {
	it('needs a quarantine role before anything quarantines', async () => {
		const response = await call(AntiRaid, { enabled: true, raid_join_action: 'quarantine' });
		expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.stringContaining('quarantine role'));
		expect(getAntiRaidConfig(GUILD).enabled).toBe(false);
	});

	it('saves valid settings', async () => {
		const response = await call(AntiRaid, { enabled: true, quarantine_role_id: QUARANTINE, join_threshold: 15 });
		expect(response.error).not.toHaveBeenCalled();
		expect(getAntiRaidConfig(GUILD)).toMatchObject({ enabled: true, quarantine_role_id: QUARANTINE, join_threshold: 15 });
	});
});

describe('PATCH moderation/logging', () => {
	it('rejects an unknown event', async () => {
		const response = await call(Logging, { routes: { nope: LOG_CHANNEL } });
		expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.stringContaining('nope'));
	});

	it('routes events and turns them off again', async () => {
		await call(Logging, { routes: { message_edit: LOG_CHANNEL, message_delete: LOG_CHANNEL } });
		expect(getLogRoutes(GUILD)).toEqual({ message_edit: LOG_CHANNEL, message_delete: LOG_CHANNEL });
		await call(Logging, { routes: { message_edit: null } });
		expect(getLogRoutes(GUILD)).toEqual({ message_delete: LOG_CHANNEL });
	});
});
