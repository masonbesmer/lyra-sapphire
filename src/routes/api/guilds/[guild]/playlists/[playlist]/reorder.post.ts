import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { readJsonBody } from '../../../_helpers';
import { loadPlaylist, parsePositiveInt } from '../../../_playlists';
import { moveTrack } from '../../../../../../lib/playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'update');
		if (!loaded) return;

		const body = await readJsonBody<{ from?: unknown; to?: unknown }>(request);
		const from = parsePositiveInt(body?.from);
		const to = parsePositiveInt(body?.to);
		if (from === null || to === null || !moveTrack(loaded.playlist.id, from - 1, to - 1)) {
			return response.error(HttpCodes.BadRequest, 'Both positions need to be in the playlist.');
		}
		return response.json({ ok: true });
	}
}
