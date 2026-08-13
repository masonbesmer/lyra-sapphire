import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';
import { getActiveFilters, FILTER_NAMES } from '../../../../lib/lavalinkFilters';

export class FiltersGetRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const player = getPlayer(guildId);
		if (!player) return response.json({ active: [], available: FILTER_NAMES });

		return response.json({ active: [...getActiveFilters(player)], available: FILTER_NAMES });
	}
}
