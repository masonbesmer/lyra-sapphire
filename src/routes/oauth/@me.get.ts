import { Route } from '@sapphire/plugin-api';
import { RouteBases, Routes } from 'discord.js';
import { fetch } from 'undici';

export class OAuthMeRoute extends Route {
	public constructor(context: Route.LoaderContext) {
		super(context, { route: 'oauth/@me', methods: ['GET'] });
	}

	public override async run(request: Route.Request, response: Route.Response) {
		const auth = this.container.server.auth;
		if (!auth) {
			return response.status(503).json({ error: 'OAuth not configured' });
		}

		// The auth middleware already decrypted the cookie into request.auth - no need to redo it here.
		if (!request.auth) {
			return response.status(401).json({ error: 'Not authenticated' });
		}

		const result = await fetch(`${RouteBases.api}${Routes.user()}`, {
			headers: { authorization: `Bearer ${request.auth.token}` }
		});
		if (!result.ok) {
			return response.status(401).json({ error: 'Failed to fetch user' });
		}

		return response.json(await result.json());
	}
}
