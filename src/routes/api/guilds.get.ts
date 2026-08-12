import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import { RouteBases, Routes } from 'discord.js';
import { fetch } from 'undici';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const auth = request.auth;
		if (!auth) return response.error(HttpCodes.Unauthorized);

		const botGuildIds = new Set(container.client.guilds.cache.keys());
		const loginData = await container.server.auth?.fetchData(auth.token).catch(() => null);
		const userGuilds = loginData?.guilds ?? [];

		// TEMP diagnostic for the "no shared servers" incident: Auth#fetchData() swallows non-OK
		// Discord responses into null, so probe directly to see the actual status/body. Remove
		// once root cause (token/scope, rate limit, or pagination) is confirmed.
		if (!loginData?.guilds) {
			try {
				const probe = await fetch(`${RouteBases.api}${Routes.userGuilds()}`, {
					headers: { authorization: `Bearer ${auth.token}` }
				});
				const detail = probe.ok ? null : await probe.text().catch(() => '<unreadable body>');
				container.logger.warn(`[api/guilds] Discord userGuilds fetch failed for user ${auth.id}: status=${probe.status} body=${detail}`);
			} catch (err) {
				container.logger.warn(`[api/guilds] Discord userGuilds fetch threw for user ${auth.id}: ${err}`);
			}
		} else if (userGuilds.length > 0 && !userGuilds.some((g) => botGuildIds.has(g.id))) {
			container.logger.warn(
				`[api/guilds] user ${auth.id}: ${userGuilds.length} guilds from Discord, 0 overlap with bot's ${botGuildIds.size} guilds`
			);
		}

		const shared = userGuilds.filter((g) => botGuildIds.has(g.id));
		return response.json(shared);
	}
}
