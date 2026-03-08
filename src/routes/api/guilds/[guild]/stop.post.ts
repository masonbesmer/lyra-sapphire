import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/stop' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const player = getPlayer(guildId);
		if (!player) return response.error(HttpCodes.NotFound);

		await player.destroy();
		return response.json({ ok: true });
	}
}
