import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const auth = request.auth;
		if (!auth) return response.error(HttpCodes.Unauthorized);

		const botGuildIds = new Set(container.client.guilds.cache.keys());
		const userGuilds: any[] = (auth.data as any)?.guilds ?? [];

		const shared = userGuilds.filter((g: any) => botGuildIds.has(g.id));
		return response.json(shared);
	}
}
