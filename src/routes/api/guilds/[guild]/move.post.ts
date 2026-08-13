import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import type { KazagumoTrack } from 'kazagumo';
import { resolveGuild, requireDJ, getPlayer } from '../_helpers';
import { broadcastQueueUpdate } from '../../../../lib/websocket';

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

		const body = request.body as { from?: number; to?: number } | null;
		const from = body?.from;
		const to = body?.to;
		if (!from || !to || from < 1 || to < 1) return response.error(HttpCodes.BadRequest);

		const track = player.queue[from - 1] as KazagumoTrack | undefined;
		if (!track) return response.error(HttpCodes.NotFound);

		player.queue.remove(from - 1);
		player.queue.splice(to - 1, 0, track);
		broadcastQueueUpdate(guildId);
		return response.json({ ok: true });
	}
}
