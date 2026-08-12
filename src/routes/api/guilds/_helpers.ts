import type { ApiRequest, ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import type { Guild, GuildMember } from 'discord.js';
import { checkDJPermission } from '../../../lib/music';

/**
 * Validates auth + guild membership. Returns the guild and the resolved member if ok,
 * or sends an error response.
 */
export async function resolveGuild(
	request: ApiRequest,
	response: ApiResponse,
	guildId: string
): Promise<{ guild: Guild; member: GuildMember } | null> {
	const auth = request.auth;
	if (!auth) {
		response.error(HttpCodes.Unauthorized);
		return null;
	}

	const guild = container.client.guilds.cache.get(guildId);
	if (!guild) {
		response.error(HttpCodes.NotFound);
		return null;
	}

	const member = await guild.members.fetch(auth.id).catch(() => null);
	if (!member) {
		response.error(HttpCodes.Forbidden);
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
		response.error(HttpCodes.Forbidden);
		return false;
	}
	return true;
}

export function getPlayer(guildId: string) {
	return container.client.kazagumo.getPlayer(guildId) ?? null;
}

/** @deprecated Use getPlayer */
export const getQueue = getPlayer;
