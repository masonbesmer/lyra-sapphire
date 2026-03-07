import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getQueue } from '../_helpers';

export class FiltersPostRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/filters' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue) return response.error(HttpCodes.NotFound);

		const body = request.body as { filter?: string } | null;
		if (!body?.filter) return response.error(HttpCodes.BadRequest);

		await queue.filters.ffmpeg.toggle(body.filter as any);
		return response.json({ ok: true, active: queue.filters.ffmpeg.filters ?? [] });
	}
}
