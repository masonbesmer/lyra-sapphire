import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { getGatesForPath } from './commandPermissions';
import { recordConfigChange, type AuditActor } from './audit';
import { AUTOMOD_ACTIONS, MAX_LIST_ENTRIES, RULE_LIMITS, RULE_LIST_KEY, isAutomodAction, normaliseListEntry, type RuleConfig } from './automod';
import { JOIN_ACTIONS, VERIFY_MODES, isJoinAction, isVerifyMode, type AntiRaidConfig, type AntiRaidSettings } from './antiRaid';
import { MAX_SCHEDULED_MS, MAX_TIMEOUT_MS } from './moderation';

/**
 * The dashboard's Moderation tab (LYRA-13): who may see which part of it, and validation for the
 * settings it writes. The rules match the slash commands each panel stands in for, so the
 * dashboard and Discord agree on who can do what.
 */

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

/**
 * Each panel of the tab, the Discord permission its slash command needs, and the command path
 * whose `/permissions` role gates apply. A gate on a parent (`automod`) covers its subcommands.
 */
export const MOD_SCOPES = {
	cases: { permission: PermissionFlagsBits.ModerateMembers, path: 'case view' },
	members: { permission: PermissionFlagsBits.ModerateMembers, path: 'modlogs' },
	notes: { permission: PermissionFlagsBits.ModerateMembers, path: 'note list' },
	logging: { permission: PermissionFlagsBits.ManageGuild, path: 'logconfig channel' },
	automod: { permission: PermissionFlagsBits.ManageGuild, path: 'automod configure' },
	antiraid: { permission: PermissionFlagsBits.ManageGuild, path: 'antiraid set' },
	roles: { permission: PermissionFlagsBits.ManageRoles, path: 'roles panel' }
} as const;

export type ModScope = keyof typeof MOD_SCOPES;

export const MOD_SCOPE_NAMES = Object.keys(MOD_SCOPES) as ModScope[];

/** What a member needs for the dashboard to treat them as staff at all; it only decides whether the tab shows. */
export const MOD_TAB_PERMISSIONS =
	PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.Administrator;

/** Every role gate on `path` must be held, exactly like the RolePermission precondition. */
export function holdsGates(gates: readonly { required_role_id: string }[], hasRole: (roleId: string) => boolean): boolean {
	return gates.every((gate) => hasRole(gate.required_role_id));
}

/** Discord permission (Administrator and the owner pass) plus the `/permissions` role gates on `path`. */
export function canUse(member: GuildMember, permission: bigint, path: string): boolean {
	if (!member.permissions.has(permission)) return false;
	return holdsGates(getGatesForPath(member.guild.id, path), (roleId) => member.roles.cache.has(roleId));
}

export function canUseScope(member: GuildMember, scope: ModScope, path: string = MOD_SCOPES[scope].path): boolean {
	return canUse(member, MOD_SCOPES[scope].permission, path);
}

export function modAccess(member: GuildMember): Record<ModScope, boolean> {
	return Object.fromEntries(MOD_SCOPE_NAMES.map((scope) => [scope, canUseScope(member, scope)])) as Record<ModScope, boolean>;
}

// ---------------------------------------------------------------------------------------------
// AutoMod
// ---------------------------------------------------------------------------------------------

export interface RulePatch {
	enabled?: unknown;
	action?: unknown;
	duration_ms?: unknown;
	limit?: unknown;
	window_ms?: unknown;
	mode?: unknown;
	list?: unknown;
	exempt_roles?: unknown;
	exempt_channels?: unknown;
}

export interface IdChecks {
	isRole: (id: string) => boolean;
	isChannel: (id: string) => boolean;
}

function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value);
}

/** Validates a list of role or channel IDs from the dashboard. Duplicates are dropped. */
export function idList(value: unknown, exists: (id: string) => boolean, what: string): { ids: string[] } | { error: string } {
	if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return { error: `${what} must be a list of IDs.` };
	const ids = [...new Set(value as string[])];
	if (ids.length > 100) return { error: `${what} is capped at 100 entries.` };
	const missing = ids.find((id) => !exists(id));
	return missing ? { error: `${what} includes ${missing}, which isn't in this server.` } : { ids };
}

/**
 * Applies a dashboard edit to one AutoMod filter with the same rules as `/automod configure`,
 * `/automod list` and `/automod exempt`. Returns the new config, or the first problem found;
 * nothing is saved here.
 */
export function applyRulePatch(before: RuleConfig, patch: RulePatch, checks: IdChecks): { config: RuleConfig } | { error: string } {
	const rule = before.rule;
	const config: RuleConfig = structuredClone(before);
	const limits = RULE_LIMITS[rule];

	if (patch.enabled !== undefined) {
		if (typeof patch.enabled !== 'boolean') return { error: 'enabled must be true or false.' };
		config.enabled = patch.enabled;
	}
	if (patch.action !== undefined) {
		if (typeof patch.action !== 'string' || !isAutomodAction(patch.action))
			return { error: `action must be one of ${AUTOMOD_ACTIONS.join(', ')}.` };
		config.action = patch.action;
	}
	if (patch.duration_ms !== undefined) {
		if (patch.duration_ms !== null && (!isInteger(patch.duration_ms) || patch.duration_ms < 1000)) {
			return { error: 'duration must be at least one second, or empty.' };
		}
		config.durationMs = patch.duration_ms;
	}
	if (config.action === 'timeout' && config.durationMs && config.durationMs > MAX_TIMEOUT_MS) return { error: 'Discord caps timeouts at 28 days.' };
	if (config.durationMs && config.durationMs > MAX_SCHEDULED_MS) return { error: 'durations are capped at a year.' };

	if (patch.limit !== undefined) {
		if (!limits) return { error: `the ${rule} filter has no limit to set.` };
		const [min, max] = limits.limit;
		if (!isInteger(patch.limit) || patch.limit < min || patch.limit > max) return { error: `the ${rule} limit must be ${min}–${max}.` };
		config.settings.limit = patch.limit;
	}
	if (patch.window_ms !== undefined) {
		if (!limits?.window) return { error: 'only duplicates and flood have a time window.' };
		const [min, max] = limits.window;
		if (!isInteger(patch.window_ms) || patch.window_ms < min || patch.window_ms > max) {
			return { error: `the ${rule} window must be ${min / 1000}–${max / 1000} seconds.` };
		}
		config.settings.windowMs = patch.window_ms;
	}
	if (patch.mode !== undefined) {
		if (rule !== 'links') return { error: 'link mode only applies to the links filter.' };
		if (patch.mode !== 'block' && patch.mode !== 'allow') return { error: 'link mode must be block or allow.' };
		config.settings.mode = patch.mode;
	}

	if (patch.list !== undefined) {
		const key = RULE_LIST_KEY[rule];
		if (!key) return { error: `the ${rule} filter has no list.` };
		if (!Array.isArray(patch.list) || patch.list.some((entry) => typeof entry !== 'string'))
			return { error: 'the list must be a list of text entries.' };
		const entries: string[] = [];
		for (const raw of patch.list as string[]) {
			if (!raw.trim()) continue;
			const normalised = normaliseListEntry(rule, raw);
			if ('error' in normalised) return { error: `"${raw.trim().slice(0, 60)}": ${normalised.error}` };
			if (!entries.includes(normalised.value)) entries.push(normalised.value);
		}
		if (entries.length > MAX_LIST_ENTRIES) return { error: `lists are capped at ${MAX_LIST_ENTRIES} entries.` };
		(config.settings as Record<string, unknown>)[key] = entries;
	}

	if (patch.exempt_roles !== undefined) {
		const result = idList(patch.exempt_roles, checks.isRole, 'exempt roles');
		if ('error' in result) return result;
		config.exemptRoles = result.ids;
	}
	if (patch.exempt_channels !== undefined) {
		const result = idList(patch.exempt_channels, checks.isChannel, 'exempt channels');
		if ('error' in result) return result;
		config.exemptChannels = result.ids;
	}

	return { config };
}

/** One audit row per AutoMod filter field that moved. Shared by `/automod` and the dashboard. */
export function auditAutomodRule(guildId: string, actor: AuditActor, before: RuleConfig, after: RuleConfig): void {
	const prefix = `automod.${after.rule}`;
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.enabled`, before.enabled, after.enabled);
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.action`, before.action, after.action);
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.duration_ms`, before.durationMs, after.durationMs);
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.limit`, before.settings.limit ?? null, after.settings.limit ?? null);
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.window_ms`, before.settings.windowMs ?? null, after.settings.windowMs ?? null);
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.mode`, before.settings.mode ?? null, after.settings.mode ?? null);
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.exempt_roles`, before.exemptRoles.join(','), after.exemptRoles.join(','));
	recordConfigChange(guildId, actor, 'moderation', `${prefix}.exempt_channels`, before.exemptChannels.join(','), after.exemptChannels.join(','));
	const key = RULE_LIST_KEY[after.rule];
	if (key) {
		const list = (config: RuleConfig) => ((config.settings[key] as string[] | undefined) ?? []).join(', ');
		recordConfigChange(guildId, actor, 'moderation', `${prefix}.${key}`, list(before), list(after));
	}
}

// ---------------------------------------------------------------------------------------------
// Anti-raid
// ---------------------------------------------------------------------------------------------

const ANTIRAID_BOOLEANS = ['enabled', 'raid_lockdown', 'quarantine_on_join'] as const;
const ANTIRAID_NUMBERS = ['join_threshold', 'join_window_ms', 'raid_duration_ms', 'min_account_age_ms'] as const;
const ANTIRAID_ACTIONS = ['raid_join_action', 'account_age_action', 'default_avatar_action'] as const;
const ANTIRAID_ROLES = ['alert_role_id', 'quarantine_role_id', 'verify_role_id'] as const;

/**
 * Type-checks a dashboard anti-raid edit and turns it into settings. Range checks and "set a
 * quarantine role first" stay in validateSettings, which runs on the merged result.
 */
export function parseAntiRaidPatch(body: Record<string, unknown>, checks: IdChecks): { settings: AntiRaidSettings } | { error: string } {
	const settings: Record<string, unknown> = {};
	for (const key of ANTIRAID_BOOLEANS) {
		if (body[key] === undefined) continue;
		if (typeof body[key] !== 'boolean') return { error: `${key} must be true or false.` };
		settings[key] = body[key];
	}
	for (const key of ANTIRAID_NUMBERS) {
		if (body[key] === undefined) continue;
		if (!isInteger(body[key])) return { error: `${key} must be a whole number.` };
		settings[key] = body[key];
	}
	for (const key of ANTIRAID_ACTIONS) {
		if (body[key] === undefined) continue;
		if (typeof body[key] !== 'string' || !isJoinAction(body[key])) return { error: `${key} must be one of ${JOIN_ACTIONS.join(', ')}.` };
		settings[key] = body[key];
	}
	if (body.verify_mode !== undefined) {
		if (typeof body.verify_mode !== 'string' || !isVerifyMode(body.verify_mode)) {
			return { error: `verify_mode must be one of ${VERIFY_MODES.join(', ')}.` };
		}
		settings.verify_mode = body.verify_mode;
	}
	for (const key of ANTIRAID_ROLES) {
		if (body[key] === undefined) continue;
		const id = body[key];
		if (id !== null && (typeof id !== 'string' || !checks.isRole(id))) return { error: `${key}: that role doesn't exist here.` };
		settings[key] = id;
	}
	if (body.alert_channel_id !== undefined) {
		const id = body.alert_channel_id;
		if (id !== null && (typeof id !== 'string' || !checks.isChannel(id))) return { error: "I can't post in that alert channel." };
		settings.alert_channel_id = id;
	}
	return { settings: settings as AntiRaidSettings };
}

/** Only the settings, prefixed, for the audit diff (raid state changes aren't config changes). */
export function antiRaidAuditSnapshot(config: AntiRaidConfig): Record<string, unknown> {
	const { guild_id: _guild, raid_until: _until, raid_locked: _locked, raid_join_count: _count, ...settings } = config;
	return Object.fromEntries(Object.entries(settings).map(([key, value]) => [`antiraid.${key}`, value]));
}
