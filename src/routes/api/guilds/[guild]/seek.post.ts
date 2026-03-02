import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getQueue } from '../_helpers';
import { parseTimeString } from '../../../../lib/music';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/seek' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue) return response.error(HttpCodes.NotFound);

		const body = request.body as { position?: number | string } | null;
		const pos = body?.position;
		if (pos === undefined || pos === null) return response.error(HttpCodes.BadRequest);

		const ms = typeof pos === 'string' ? parseTimeString(pos) : pos;
		if (ms === null || ms < 0) return response.error(HttpCodes.BadRequest);

		await queue.node.seek(ms);
		return response.json({ ok: true, position: ms });
	}
}
