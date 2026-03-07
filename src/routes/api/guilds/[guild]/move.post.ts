import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getQueue } from '../_helpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/move' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue) return response.error(HttpCodes.NotFound);

		const body = request.body as { from?: number; to?: number } | null;
		const from = body?.from;
		const to = body?.to;
		if (!from || !to || from < 1 || to < 1) return response.error(HttpCodes.BadRequest);

		const track = queue.tracks.at(from - 1);
		if (!track) return response.error(HttpCodes.NotFound);

		queue.moveTrack(track, to - 1);
		return response.json({ ok: true });
	}
}
