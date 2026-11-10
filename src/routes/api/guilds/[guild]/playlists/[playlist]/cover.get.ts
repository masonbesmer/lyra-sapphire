import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { loadPlaylist } from '../../../_playlists';
import { getCover } from '../../../../../../lib/playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'read');
		if (!loaded) return;

		const cover = getCover(loaded.playlist.id);
		if (!cover) return response.error(HttpCodes.NotFound, 'That playlist has no cover.');

		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Cache-Control', 'private, max-age=86400');
		return response.image(cover.mime, cover.bytes);
	}
}
