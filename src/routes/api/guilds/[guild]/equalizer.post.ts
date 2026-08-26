import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, requireDJ, getPlayer, readJsonBody } from '../_helpers';
import { setCustomEq, getEqPresetGains, EQ_BAND_COUNT } from '../../../../lib/lavalinkFilters';
import { broadcastEvent, broadcastQueueUpdate } from '../../../../lib/websocket';

interface EqualizerBody {
	/** One gain per band. Unclamped - Lavalink will clip/distort past the -0.25 to 1.0 recommended range. Ignored if `preset` is also given. */
	gains?: number[];
	/** A named EQ_PRESET_NAMES entry - populates `gains` from the preset's bands. */
	preset?: string;
}

export class EqualizerPostRoute extends Route {
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

		const body = await readJsonBody<EqualizerBody>(request);

		let gains: number[] | undefined;
		if (body?.preset) {
			gains = getEqPresetGains(body.preset) ?? undefined;
			if (!gains) return response.error(HttpCodes.BadRequest, `Unknown EQ preset: ${body.preset}`);
		} else if (Array.isArray(body?.gains)) {
			if (body.gains.length !== EQ_BAND_COUNT || body.gains.some((g) => typeof g !== 'number' || !Number.isFinite(g))) {
				return response.error(HttpCodes.BadRequest);
			}
			gains = body.gains;
		}
		if (!gains) return response.error(HttpCodes.BadRequest);

		const applied = await setCustomEq(player, gains);
		broadcastEvent(guildId, 'eqChange', { gains: applied });
		broadcastQueueUpdate(guildId);
		return response.json({ ok: true, gains: applied });
	}
}
