import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getPlayer } from '../_helpers';
import { cleanTrackTitle } from '../../../../lib/music';
import { fetchLyrics } from '../../../../lib/lyrics';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const player = getPlayer(guildId);
		if (!player?.queue.current) return response.error(HttpCodes.NotFound);

		const track = player.queue.current;
		const query = cleanTrackTitle(track.title);
		const result = await fetchLyrics({ title: track.title, author: track.author, length: track.length });
		return response.json({ lyrics: result?.lyrics ?? null, query, title: result?.title });
	}
}
