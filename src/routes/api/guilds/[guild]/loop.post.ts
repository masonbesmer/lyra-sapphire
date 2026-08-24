import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, requireDJ, getPlayer, readJsonBody } from '../_helpers';
import { broadcastEvent, broadcastQueueUpdate } from '../../../../lib/websocket';

const VALID_MODES = ['none', 'track', 'queue'] as const;
type LoopMode = (typeof VALID_MODES)[number];

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

		const body = await readJsonBody<{ mode?: string }>(request);
		const modeStr = body?.mode?.toLowerCase() as LoopMode | undefined;
		if (!modeStr || !VALID_MODES.includes(modeStr)) return response.error(HttpCodes.BadRequest);

		player.setLoop(modeStr);
		broadcastEvent(guildId, 'loopChange', { mode: modeStr });
		broadcastQueueUpdate(guildId);
		return response.json({ ok: true, mode: modeStr });
	}
}
