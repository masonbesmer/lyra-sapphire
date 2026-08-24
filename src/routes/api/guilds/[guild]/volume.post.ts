import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, requireDJ, getPlayer, readJsonBody } from '../_helpers';
import { broadcastEvent, broadcastQueueUpdate } from '../../../../lib/websocket';

export class UserRoute extends Route {
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

		const body = await readJsonBody<{ volume?: number }>(request);
		const vol = body?.volume;
		if (!vol || vol < 1 || vol > 100) return response.error(HttpCodes.BadRequest);

		await player.setVolume(vol);
		broadcastEvent(guildId, 'volumeChange', { volume: vol });
		broadcastQueueUpdate(guildId);
		return response.json({ ok: true, volume: vol });
	}
}
