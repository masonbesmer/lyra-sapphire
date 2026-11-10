import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { loadPlaylist, serializeDetail } from '../../_playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'read');
		if (!loaded) return;
		return response.json(await serializeDetail(loaded));
	}
}
