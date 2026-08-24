import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import { RouteBases, Routes } from 'discord.js';
import { fetch } from 'undici';
import { getOrCreateSlug } from '../../lib/slug';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const auth = request.auth;
		if (!auth) {
			// TEMP diagnostic for the "no shared servers" incident: distinguishes a dead/missing
			// session cookie from a Discord-side guilds-fetch failure, since the frontend collapses
			// both into the same empty-list UI. Remove once root cause is confirmed.
			container.logger.warn('[api/guilds] request.auth is null (missing/invalid/expired session cookie) - returning 401');
			return response.error(HttpCodes.Unauthorized);
		}

		const botGuildIds = new Set(container.client.guilds.cache.keys());
		const loginData = await container.server.auth?.fetchData(auth.token).catch(() => null);
		const userGuilds = loginData?.guilds ?? [];

		// TEMP diagnostic for the "no shared servers" incident: Auth#fetchData() swallows non-OK
		// Discord responses into null, so probe directly to see the actual status/body. Also covers
		// the case where Discord's call succeeds but legitimately returns 0 guilds, which the
		// original logging missed (an empty array is truthy, so it fell through both branches).
		// Remove once root cause (auth, token/scope, rate limit, or pagination) is confirmed.
		if (!loginData || loginData.guilds == null) {
			try {
				const probe = await fetch(`${RouteBases.api}${Routes.userGuilds()}`, {
					headers: { authorization: `Bearer ${auth.token}` }
				});
				const detail = probe.ok ? null : await probe.text().catch(() => '<unreadable body>');
				container.logger.warn(`[api/guilds] Discord userGuilds fetch failed for user ${auth.id}: status=${probe.status} body=${detail}`);
			} catch (err) {
				container.logger.warn(`[api/guilds] Discord userGuilds fetch threw for user ${auth.id}: ${err}`);
			}
		} else if (userGuilds.length === 0) {
			container.logger.warn(`[api/guilds] user ${auth.id}: Discord returned 0 guilds (legit empty list, not a fetch failure)`);
		} else if (!userGuilds.some((g) => botGuildIds.has(g.id))) {
			container.logger.warn(
				`[api/guilds] user ${auth.id}: ${userGuilds.length} guilds from Discord, 0 overlap with bot's ${botGuildIds.size} guilds`
			);
		}

		const shared = userGuilds.filter((g) => botGuildIds.has(g.id)).map((g) => ({ ...g, slug: getOrCreateSlug(g.id, g.name) }));
		return response.json(shared);
	}
}
