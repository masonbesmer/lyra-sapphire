import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { QueueRepeatMode } from 'discord-player';
import { resolveGuild, getQueue } from '../_helpers';

const MODE_MAP: Record<string, QueueRepeatMode> = {
	off: QueueRepeatMode.OFF,
	track: QueueRepeatMode.TRACK,
	queue: QueueRepeatMode.QUEUE,
	autoplay: QueueRepeatMode.AUTOPLAY
};

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/loop' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue) return response.error(HttpCodes.NotFound);

		const body = request.body as { mode?: string } | null;
		const modeStr = body?.mode?.toLowerCase();
		if (!modeStr || !(modeStr in MODE_MAP)) return response.error(HttpCodes.BadRequest);

		queue.setRepeatMode(MODE_MAP[modeStr]);
		return response.json({ ok: true, mode: modeStr });
	}
}
