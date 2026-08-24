import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, requireDJ, getPlayer, readJsonBody } from '../_helpers';
import { toggleFilter, getActiveFilters, FILTER_NAMES } from '../../../../lib/lavalinkFilters';
import { broadcastEvent, broadcastQueueUpdate } from '../../../../lib/websocket';

export class FiltersPostRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;
		if (!requireDJ(response, resolved.guild, resolved.member)) return;

		const player = getPlayer(guildId);
		if (!player) return response.error(HttpCodes.NotFound);

		const body = await readJsonBody<{ filter?: string }>(request);
		if (!body?.filter || !FILTER_NAMES.includes(body.filter)) return response.error(HttpCodes.BadRequest);

		await toggleFilter(player, body.filter);
		const active = [...getActiveFilters(player)];
		broadcastEvent(guildId, 'filterChange', { active });
		broadcastQueueUpdate(guildId);
		return response.json({ ok: true, active });
	}
}
