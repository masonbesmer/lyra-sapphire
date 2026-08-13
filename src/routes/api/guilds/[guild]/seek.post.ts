import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, requireDJ, getPlayer } from '../_helpers';
import { parseTimeString } from '../../../../lib/music';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;
		// D24 gates this to match its route list verbatim, even though D16/Phase 2
		// record /seek as intentionally ungated on the Discord command side.
		if (!requireDJ(response, resolved.guild, resolved.member)) return;

		const player = getPlayer(guildId);
		if (!player) return response.error(HttpCodes.NotFound);

		const body = request.body as { position?: number | string } | null;
		const pos = body?.position;
		if (pos === undefined || pos === null) return response.error(HttpCodes.BadRequest);

		const ms = typeof pos === 'string' ? parseTimeString(pos) : pos;
		if (ms === null || ms < 0) return response.error(HttpCodes.BadRequest);

		await player.seek(ms);
		return response.json({ ok: true, position: ms });
	}
}
