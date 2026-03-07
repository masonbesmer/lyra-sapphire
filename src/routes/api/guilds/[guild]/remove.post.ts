import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getQueue } from '../_helpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/remove' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue) return response.error(HttpCodes.NotFound);

		const body = request.body as { position?: number } | null;
		const pos = body?.position;
		if (pos === undefined || pos === null || pos < 1) return response.error(HttpCodes.BadRequest);

		const track = queue.tracks.at(pos - 1);
		if (!track) return response.error(HttpCodes.NotFound);

		queue.removeTrack(track);
		return response.json({ ok: true, removed: { title: track.title, url: track.url } });
	}
}
