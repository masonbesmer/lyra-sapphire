import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { loadPlaylist, parsePositiveInt } from '../../../../_playlists';
import { removeTrack } from '../../../../../../../lib/playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'delete');
		if (!loaded) return;

		const trackId = parsePositiveInt(request.params.track);
		if (trackId === null || !removeTrack(loaded.playlist.id, trackId)) {
			return response.error(HttpCodes.NotFound, 'That track is not in this playlist.');
		}
		return response.json({ ok: true });
	}
}
