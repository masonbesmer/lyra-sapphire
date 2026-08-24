import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';
import { getCustomEq, EQ_BAND_FREQUENCIES, EQ_PRESET_NAMES } from '../../../../lib/lavalinkFilters';

export class EqualizerGetRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const player = getPlayer(guildId);
		const gains = player ? getCustomEq(player) : new Array<number>(EQ_BAND_FREQUENCIES.length).fill(0);

		return response.json({ gains, frequencies: EQ_BAND_FREQUENCIES, presets: EQ_PRESET_NAMES });
	}
}
