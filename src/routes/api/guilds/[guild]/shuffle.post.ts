import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, requireDJ } from '../_helpers';
import * as musicActions from '../../../../lib/musicActions';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;
		if (!requireDJ(response, resolved.guild, resolved.member)) return;

		const result = await musicActions.shuffle(guildId);
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

		return response.json({ ok: true });
	}
}
