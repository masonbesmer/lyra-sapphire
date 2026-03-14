import { Route } from '@sapphire/plugin-api';
import { OAuth2Routes } from 'discord.js';
import { stringify } from 'querystring';
import { fetch } from 'undici';

export class OAuthCallbackRoute extends Route {
	public constructor(context: Route.LoaderContext) {
		super(context, { route: 'oauth/callback', methods: ['GET'] });
	}

	public override async run(request: Route.Request, response: Route.Response) {
		const auth = this.container.server.auth;
		if (!auth) {
			return response.status(503).json({ error: 'OAuth not configured' });
		}

		const code = (request.query as Record<string, string>)?.code ?? null;
		if (!code) {
			response.writeHead(302, { Location: '/?error=missing_code' });
			return response.end();
		}

		// Exchange code for token
		const tokenRes = await fetch(OAuth2Routes.tokenURL, {
			method: 'POST',
			body: stringify({
				client_id: auth.id,
				client_secret: auth.secret,
				code,
				grant_type: 'authorization_code',
				redirect_uri: auth.redirect
			}),
			headers: { 'content-type': 'application/x-www-form-urlencoded' }
		});

		if (!tokenRes.ok) {
			this.container.logger.error(await tokenRes.json());
			response.writeHead(302, { Location: '/?error=token_exchange_failed' });
			return response.end();
		}

		const tokenData = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
		const userData = await auth.fetchData(tokenData.access_token);

		if (!userData.user) {
			response.writeHead(302, { Location: '/?error=user_fetch_failed' });
			return response.end();
		}

		const now = Date.now();
		const token = auth.encrypt({
			id: userData.user.id,
			expires: now + tokenData.expires_in * 1000,
			refresh: tokenData.refresh_token,
			token: tokenData.access_token
		});

		response.cookies.add(auth.cookie, token, { maxAge: tokenData.expires_in });
		response.writeHead(302, { Location: '/' });
		response.end();
	}
}
