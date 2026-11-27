import { HttpCodes, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import type { Guild, GuildMember } from 'discord.js';
import { getAutomodSettings } from '../../../lib/automod';
import { describeSyncReport, syncNativeRules } from '../../../lib/automodNative';
import { ModError, describeError } from '../../../lib/modActions';
import { canUseScope, type IdChecks, type ModScope } from '../../../lib/modDashboard';
import { getEntries, type RolePanel } from '../../../lib/selfRoles';
import { resolveGuild } from './_helpers';

/** Shared plumbing for the dashboard's Moderation tab routes (LYRA-13). */

const DENIED: Record<ModScope, string> = {
	cases: 'Browsing cases needs Moderate Members (and any /permissions gate on /case).',
	members: 'Member lookup needs Moderate Members (and any /permissions gate on /modlogs).',
	notes: 'Notes need Moderate Members (and any /permissions gate on /note).',
	logging: 'Event logging settings need Manage Server (and any /permissions gate on /logconfig).',
	automod: 'AutoMod settings need Manage Server (and any /permissions gate on /automod).',
	antiraid: 'Anti-raid settings need Manage Server (and any /permissions gate on /antiraid).',
	roles: 'Role panels need Manage Roles (and any /permissions gate on /roles).'
};

/**
 * Auth, guild membership, then the same Discord permission and `/permissions` role gates as the
 * slash command the panel stands in for. Sends the error response and returns null on refusal.
 */
export async function resolveModerator(
	request: ApiRequest,
	response: ApiResponse,
	scope: ModScope,
	paths?: string[]
): Promise<{ guild: Guild; member: GuildMember } | null> {
	const resolved = await resolveGuild(request, response, request.params.guild);
	if (!resolved) return null;
	const allowed = paths?.length ? paths.every((path) => canUseScope(resolved.member, scope, path)) : canUseScope(resolved.member, scope);
	if (!allowed) {
		response.error(HttpCodes.Forbidden, DENIED[scope]);
		return null;
	}
	return resolved;
}

export function idChecks(guild: Guild): IdChecks {
	return {
		isRole: (id) => id !== guild.id && guild.roles.cache.has(id),
		isChannel: (id) => guild.channels.cache.get(id)?.isSendable() === true
	};
}

/** A ModError is the moderator's mistake (400); anything else is logged and reported as a 500. */
export function sendFailure(response: ApiResponse, error: unknown): void {
	const message = describeError(error);
	response.error(
		error instanceof ModError ? HttpCodes.BadRequest : HttpCodes.InternalServerError,
		message.charAt(0).toUpperCase() + message.slice(1)
	);
}

/** Re-mirrors AutoMod into Discord's native rules when that's on. Returns a warning when something didn't sync. */
export async function resyncNative(guild: Guild): Promise<string | null> {
	if (!getAutomodSettings(guild.id).nativeSync) return null;
	try {
		const report = await syncNativeRules(guild);
		if (!report.failed.length && !report.skipped.length) return null;
		return `Native AutoMod: ${describeSyncReport(report)}`;
	} catch (error) {
		return `Couldn't update native AutoMod: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export function panelView(guild: Guild, panel: RolePanel) {
	return {
		...panel,
		owned: panel.owned === 1,
		url: `https://discord.com/channels/${guild.id}/${panel.channel_id}/${panel.message_id}`,
		channel_name: guild.channels.cache.get(panel.channel_id)?.name ?? null,
		entries: getEntries(panel.id).map((entry) => ({ ...entry, role_name: guild.roles.cache.get(entry.role_id)?.name ?? null }))
	};
}
