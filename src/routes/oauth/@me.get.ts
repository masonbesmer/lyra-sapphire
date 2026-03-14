import { Route } from '@sapphire/plugin-api';

export class OAuthMeRoute extends Route {
	public constructor(context: Route.LoaderContext) {
		super(context, { route: 'oauth/@me', methods: ['GET'] });
	}

	public override async run(request: Route.Request, response: Route.Response) {
		const auth = this.container.server.auth;
		if (!auth) {
			return response.status(503).json({ error: 'OAuth not configured' });
		}

		const cookieValue = response.cookies.get(auth.cookie);
		if (!cookieValue) {
			return response.status(401).json({ error: 'Not authenticated' });
		}

		const session = auth.decrypt(cookieValue);
		if (!session) {
			return response.status(401).json({ error: 'Session expired' });
		}

		const userData = await auth.fetchData(session.token);
		if (!userData.user) {
			return response.status(401).json({ error: 'Failed to fetch user' });
		}

		return response.json(userData.user);
	}
}
