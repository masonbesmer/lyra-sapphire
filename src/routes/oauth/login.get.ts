import { Route } from '@sapphire/plugin-api';
import { OAuth2Routes } from 'discord.js';
import { randomBytes } from 'node:crypto';

export const OAUTH_STATE_COOKIE = 'lyra_oauth_state';

export class OAuthLoginRoute extends Route {
	public constructor(context: Route.LoaderContext) {
		super(context, { route: 'oauth/login', methods: ['GET'] });
	}

	public override run(_request: Route.Request, response: Route.Response) {
		const auth = this.container.server.auth;
		if (!auth) {
			return response.status(503).json({ error: 'OAuth not configured' });
		}

		const state = randomBytes(32).toString('hex');
		response.cookies.add(OAUTH_STATE_COOKIE, state, { maxAge: 300, httpOnly: true });

		const params = new URLSearchParams({
			client_id: auth.id,
			redirect_uri: auth.redirect!,
			response_type: 'code',
			scope: auth.scopes.join(' '),
			state
		});

		response.writeHead(302, { Location: `${OAuth2Routes.authorizationURL}?${params}` });
		response.end();
	}
}
