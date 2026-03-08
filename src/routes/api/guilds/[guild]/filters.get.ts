import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';
import { getActiveFilters } from '../../../../lib/lavalinkFilters';

export class FiltersGetRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/filters' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const player = getPlayer(guildId);
		if (!player) return response.json({ active: [] });

		return response.json({ active: [...getActiveFilters(player)] });
	}
}
