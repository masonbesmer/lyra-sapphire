import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { loadPlaylist } from '../../_playlists';
import { deletePlaylist } from '../../../../../lib/playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'manage');
		if (!loaded) return;
		deletePlaylist(loaded.playlist.id);
		return response.json({ ok: true });
	}
}
