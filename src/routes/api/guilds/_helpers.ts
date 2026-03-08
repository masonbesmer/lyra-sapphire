import type { ApiRequest, ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';

/**
 * Validates auth + guild membership. Returns the guild if ok, or sends an error response.
 */
export function resolveGuild(request: ApiRequest, response: ApiResponse, guildId: string) {
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

	const userGuilds: any[] = (auth.data as any)?.guilds ?? [];
	const inGuild = userGuilds.some((g: any) => g.id === guildId);
	if (!inGuild) {
		response.error(HttpCodes.Forbidden);
		return null;
	}

	return guild;
}

export function getPlayer(guildId: string) {
	return container.client.kazagumo.getPlayer(guildId) ?? null;
}

/** @deprecated Use getPlayer */
export const getQueue = getPlayer;
