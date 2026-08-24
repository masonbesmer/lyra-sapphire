import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { serializeVoiceState } from '../../../../lib/music';

/**
 * The caller's own voice channel in this guild. The dashboard uses it to pick the channel
 * to queue into, and to decide whether to show the player at all - live updates then arrive
 * over the WebSocket's `voiceState` message.
 */
export class VoiceStateGetRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;

		return response.json(serializeVoiceState(resolved.member));
	}
}
