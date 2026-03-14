import { Route } from '@sapphire/plugin-api';
import { OAuth2Routes } from 'discord.js';

export class OAuthLoginRoute extends Route {
	public constructor(context: Route.LoaderContext) {
		super(context, { route: 'oauth/login', methods: ['GET'] });
	}

	public override run(_request: Route.Request, response: Route.Response) {
		const auth = this.container.server.auth;
		if (!auth) {
			return response.status(503).json({ error: 'OAuth not configured' });
		}

		const params = new URLSearchParams({
			client_id: auth.id,
			redirect_uri: auth.redirect!,
			response_type: 'code',
			scope: auth.scopes.join(' ')
		});

		response.writeHead(302, { Location: `${OAuth2Routes.authorizationURL}?${params}` });
		response.end();
	}
}
