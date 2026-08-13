import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { resolveGuild } from '../_helpers';
import { serializeTrack } from '../../../../lib/music';

/** Search-only preview for the dashboard's SearchBar - unlike /play, this never queues anything. */
export class SearchGetRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const query = (request.query as Record<string, string>)?.query;
		if (!query?.trim()) return response.error(HttpCodes.BadRequest);

		try {
			const result = await container.client.kazagumo.search(query, { requester: null });
			return response.json({ tracks: result.tracks.slice(0, 10).map(serializeTrack) });
		} catch (e) {
			container.logger.error(`[API/search] ${String(e)}`);
			return response.error(HttpCodes.InternalServerError);
		}
	}
}
