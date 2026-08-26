import type { ApiRequest, ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import type { Guild, GuildMember } from 'discord.js';
import { checkDJPermission } from '../../../lib/music';
import { getGuildIdBySlug } from '../../../lib/slug';

/**
 * Validates auth + guild membership. Returns the guild and the resolved member if ok,
 * or sends an error response. Accepts either a raw guild ID or the guild's URL slug.
 */
export async function resolveGuild(
	request: ApiRequest,
	response: ApiResponse,
	guildIdOrSlug: string
): Promise<{ guild: Guild; member: GuildMember } | null> {
	const auth = request.auth;
	if (!auth) {
		response.error(HttpCodes.Unauthorized, 'Your session expired - log in again.');
		return null;
	}

	const guildId = container.client.guilds.cache.has(guildIdOrSlug) ? guildIdOrSlug : (getGuildIdBySlug(guildIdOrSlug) ?? guildIdOrSlug);

	const guild = container.client.guilds.cache.get(guildId);
	if (!guild) {
		response.error(HttpCodes.NotFound, 'The bot is not in that server.');
		return null;
	}

	const member = await guild.members.fetch(auth.id).catch(() => null);
	if (!member) {
		response.error(HttpCodes.Forbidden, 'You are not a member of that server.');
		return null;
	}

	return { guild, member };
}

/**
 * Gates a destructive action behind the guild's DJ role, mirroring the Discord-side
 * checkDJPermission used by playerControls.ts. Returns false and sends an error
 * response if the member doesn't have permission.
 */
export function requireDJ(response: ApiResponse, guild: Guild, member: GuildMember): boolean {
	if (!checkDJPermission(member, guild.id)) {
		response.error(HttpCodes.Forbidden, 'That action needs the DJ role.');
		return false;
	}
	return true;
}

export function getPlayer(guildId: string) {
	return container.client.kazagumo.getPlayer(guildId) ?? null;
}

/** @deprecated Use getPlayer */
export const getQueue = getPlayer;

/**
 * plugin-api v8 dropped the pre-parsed `request.body` field in favour of an
 * async readBody(). Reading the old field yielded undefined, which made every
 * body-carrying route 400 before it ran.
 */
export async function readJsonBody<T>(request: ApiRequest): Promise<T | null> {
	return (await request.readBody().catch(() => null)) as T | null;
}

/**
 * Gates the server-configuration surface. Mirrors the /config command's own check
 * (ManageGuild or Administrator) so the dashboard and Discord agree on who is an admin.
 */
export function requireAdmin(response: ApiResponse, member: GuildMember): boolean {
	if (!member.permissions.has('ManageGuild') && !member.permissions.has('Administrator')) {
		response.error(HttpCodes.Forbidden, 'That needs Manage Server.');
		return false;
	}
	return true;
}
