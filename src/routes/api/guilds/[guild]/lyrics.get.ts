import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, getQueue } from '../_helpers';
import { cleanTrackTitle } from '../../../../lib/music';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/lyrics' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const queue = getQueue(guildId);
		if (!queue?.currentTrack) return response.error(HttpCodes.NotFound);

		const query = cleanTrackTitle(queue.currentTrack.title);

		try {
			const { Client } = await import('genius-lyrics');
			const client = new Client();
			const searches = await client.songs.search(query);
			if (!searches.length) return response.json({ lyrics: null, query });
			const lyrics = await searches[0].lyrics();
			return response.json({ lyrics: lyrics ?? null, query, title: searches[0].title });
		} catch (e) {
			return response.json({ lyrics: null, query });
		}
	}
}
