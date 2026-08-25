import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';
import * as musicActions from '../../../../lib/musicActions';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const player = getPlayer(guildId);
		if (!player) return response.error(HttpCodes.NotFound);

		const result = await musicActions.pause(guildId, !player.paused);
		if (!result.ok) {
			switch (result.code) {
				case 'no_player':
					return response.error(HttpCodes.NotFound);
				case 'bad_input':
					return response.error(HttpCodes.BadRequest);
				default:
					return response.error(HttpCodes.InternalServerError);
			}
		}

		return response.json({ ok: true, paused: result.data.paused });
	}
}
