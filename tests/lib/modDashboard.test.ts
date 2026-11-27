import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ANTIRAID, getAntiRaidConfig } from '../../src/lib/antiRaid';
import { getConfigAudit } from '../../src/lib/audit';
import { getRule } from '../../src/lib/automod';
import { setCommandPermission } from '../../src/lib/config';
import {
	antiRaidAuditSnapshot,
	applyRulePatch,
	auditAutomodRule,
	canUse,
	canUseScope,
	holdsGates,
	idList,
	modAccess,
	parseAntiRaidPatch
} from '../../src/lib/modDashboard';
import { guildMember } from '../helpers/discord';

const checks = { isRole: (id: string) => id.startsWith('role'), isChannel: (id: string) => id.startsWith('chan') };

function staff(guildId: string, permissions: bigint, roleIds: string[] = []) {
	return guildMember({
		id: 'mod',
		guild: { id: guildId },
		permissions: new PermissionsBitField(permissions),
		roles: { cache: new Map(roleIds.map((id) => [id, {}])) }
	});
}

describe('access', () => {
	it('needs every gate on the path', () => {
		const gates = [{ required_role_id: 'a' }, { required_role_id: 'b' }];
		expect(holdsGates(gates, (id) => id === 'a')).toBe(false);
		expect(holdsGates(gates, () => true)).toBe(true);
		expect(holdsGates([], () => false)).toBe(true);
	});

	it('needs the same Discord permission as the slash command', () => {
		const mod = staff('g-access', PermissionFlagsBits.ModerateMembers);
		expect(canUseScope(mod, 'cases')).toBe(true);
		expect(canUseScope(mod, 'automod')).toBe(false);
		expect(canUseScope(mod, 'roles')).toBe(false);
		const admin = staff('g-access', PermissionFlagsBits.Administrator);
		expect(Object.values(modAccess(admin)).every(Boolean)).toBe(true);
	});

	it('applies /permissions role gates, including ones on a parent command', () => {
		setCommandPermission('g-gates', 'automod', 'role-automod');
		setCommandPermission('g-gates', 'case view', 'role-cases');
		const without = staff('g-gates', PermissionFlagsBits.Administrator);
		expect(canUse(without, PermissionFlagsBits.ManageGuild, 'automod configure')).toBe(false);
		expect(canUseScope(without, 'cases')).toBe(false);
		expect(canUseScope(without, 'logging')).toBe(true);
		const withRoles = staff('g-gates', PermissionFlagsBits.Administrator, ['role-automod', 'role-cases']);
		expect(canUseScope(withRoles, 'automod', 'automod list add')).toBe(true);
		expect(canUseScope(withRoles, 'cases')).toBe(true);
	});
});

describe('idList', () => {
	it('dedupes and rejects unknown IDs', () => {
		expect(idList(['role1', 'role1', 'role2'], checks.isRole, 'roles')).toEqual({ ids: ['role1', 'role2'] });
		expect(idList(['role1', 'nope'], checks.isRole, 'roles')).toEqual({ error: expect.stringContaining('nope') });
		expect(idList('role1', checks.isRole, 'roles')).toHaveProperty('error');
	});
});

describe('applyRulePatch', () => {
	const flood = getRule('g-patch', 'flood');
	const words = getRule('g-patch', 'words');

	it('applies valid changes without touching the original', () => {
		const result = applyRulePatch(flood, { enabled: true, action: 'timeout', duration_ms: 3_600_000, limit: 8, window_ms: 10_000 }, checks);
		expect(result).toMatchObject({
			config: { enabled: true, action: 'timeout', durationMs: 3_600_000, settings: { limit: 8, windowMs: 10_000 } }
		});
		expect(flood.enabled).toBe(false);
	});

	it('enforces the same limits as /automod configure', () => {
		expect(applyRulePatch(flood, { limit: 999 }, checks)).toHaveProperty('error');
		expect(applyRulePatch(flood, { window_ms: 1 }, checks)).toHaveProperty('error');
		expect(applyRulePatch(words, { limit: 5 }, checks)).toEqual({ error: expect.stringContaining('no limit') });
		expect(applyRulePatch(words, { mode: 'allow' }, checks)).toHaveProperty('error');
		expect(applyRulePatch(flood, { action: 'explode' }, checks)).toHaveProperty('error');
		expect(applyRulePatch(flood, { action: 'timeout', duration_ms: 29 * 24 * 3_600_000 }, checks)).toEqual({
			error: expect.stringContaining('28 days')
		});
	});

	it('normalises and dedupes list entries, and rejects bad ones', () => {
		const result = applyRulePatch(words, { list: ['Spam', 'spam', '  ', '/fr[e3]e/'] }, checks);
		expect(result).toMatchObject({ config: { settings: { words: ['spam', '/fr[e3]e/'] } } });
		expect(applyRulePatch(words, { list: ['/(a+)+/'] }, checks)).toHaveProperty('error');
		expect(applyRulePatch(flood, { list: ['x'] }, checks)).toEqual({ error: expect.stringContaining('no list') });
	});

	it('checks exemptions exist in the server', () => {
		expect(applyRulePatch(words, { exempt_roles: ['role1'], exempt_channels: ['chan1'] }, checks)).toMatchObject({
			config: { exemptRoles: ['role1'], exemptChannels: ['chan1'] }
		});
		expect(applyRulePatch(words, { exempt_channels: ['role1'] }, checks)).toHaveProperty('error');
	});

	it('audits each field that moved, including the list', () => {
		const actor = { id: 'mod', name: 'mod', source: 'dashboard' as const };
		const result = applyRulePatch(words, { enabled: true, list: ['spam'] }, checks);
		if ('error' in result) throw new Error(result.error);
		auditAutomodRule('g-patch', actor, words, result.config);
		const settings = getConfigAudit('g-patch').map((row) => row.setting);
		expect(settings).toEqual(expect.arrayContaining(['automod.words.enabled', 'automod.words.words']));
		expect(settings).not.toContain('automod.words.action');
	});
});

describe('parseAntiRaidPatch', () => {
	it('type-checks every field', () => {
		expect(parseAntiRaidPatch({ enabled: 'yes' }, checks)).toHaveProperty('error');
		expect(parseAntiRaidPatch({ join_threshold: 1.5 }, checks)).toHaveProperty('error');
		expect(parseAntiRaidPatch({ raid_join_action: 'nuke' }, checks)).toHaveProperty('error');
		expect(parseAntiRaidPatch({ quarantine_role_id: 'nope' }, checks)).toHaveProperty('error');
		expect(parseAntiRaidPatch({ alert_channel_id: 'role1' }, checks)).toHaveProperty('error');
	});

	it('passes valid settings through and ignores unknown keys', () => {
		expect(
			parseAntiRaidPatch({ enabled: true, join_threshold: 12, quarantine_role_id: 'role1', alert_channel_id: null, raid_until: 'x' }, checks)
		).toEqual({ settings: { enabled: true, join_threshold: 12, quarantine_role_id: 'role1', alert_channel_id: null } });
	});

	it('snapshots settings only, prefixed', () => {
		const snapshot = antiRaidAuditSnapshot(getAntiRaidConfig('g-ar'));
		expect(snapshot['antiraid.join_threshold']).toBe(DEFAULT_ANTIRAID.join_threshold);
		expect(Object.keys(snapshot)).not.toContain('antiraid.raid_until');
		expect(Object.keys(snapshot)).not.toContain('antiraid.guild_id');
	});
});
