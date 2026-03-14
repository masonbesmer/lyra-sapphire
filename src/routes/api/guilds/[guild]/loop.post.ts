import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';

const VALID_MODES = ['none', 'track', 'queue'] as const;
type LoopMode = (typeof VALID_MODES)[number];

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/loop' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const player = getPlayer(guildId);
		if (!player) return response.error(HttpCodes.NotFound);

		const body = request.body as { mode?: string } | null;
		const modeStr = body?.mode?.toLowerCase() as LoopMode | undefined;
		if (!modeStr || !VALID_MODES.includes(modeStr)) return response.error(HttpCodes.BadRequest);

		player.setLoop(modeStr);
		return response.json({ ok: true, mode: modeStr });
	}
}
