import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';
import { broadcastEvent, broadcastQueueUpdate } from '../../../../lib/websocket';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/pause' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const player = getPlayer(guildId);
		if (!player) return response.error(HttpCodes.NotFound);

		if (player.paused) {
			player.pause(false);
		} else {
			player.pause(true);
		}
		broadcastEvent(guildId, 'pauseStateChange', { paused: player.paused });
		broadcastQueueUpdate(guildId);
		return response.json({ ok: true, paused: player.paused });
	}
}
