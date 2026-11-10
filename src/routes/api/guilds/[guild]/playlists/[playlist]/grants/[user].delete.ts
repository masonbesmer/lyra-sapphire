import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { loadPlaylist } from '../../../../_playlists';
import { revokeGrant } from '../../../../../../../lib/playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'manage');
		if (!loaded) return;

		if (!revokeGrant(loaded.playlist.id, request.params.user)) return response.error(HttpCodes.NotFound, 'That user had no access to revoke.');
		return response.json({ ok: true });
	}
}
