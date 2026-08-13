import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { serializePlayer } from '../../../../lib/music';
import { resolveGuild, getPlayer } from '../_helpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const player = getPlayer(guildId);
		return response.json(serializePlayer(player));
	}
}
