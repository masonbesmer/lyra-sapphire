import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getQueue } from '../_helpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/volume' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue) return response.error(HttpCodes.NotFound);

		const body = request.body as { volume?: number } | null;
		const vol = body?.volume;
		if (!vol || vol < 1 || vol > 100) return response.error(HttpCodes.BadRequest);

		queue.node.setVolume(vol);
		return response.json({ ok: true, volume: vol });
	}
}
