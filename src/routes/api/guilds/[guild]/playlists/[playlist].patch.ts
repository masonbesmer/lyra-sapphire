import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { readJsonBody } from '../../_helpers';
import { loadPlaylist, sendPlaylistError, serializeSummary } from '../../_playlists';
import { updatePlaylist } from '../../../../../lib/playlists';

interface Body {
	name?: unknown;
	description?: unknown;
	isPublic?: unknown;
}

const FORBIDDEN = "You don't have permission to do that to this playlist.";

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'read');
		if (!loaded) return;
		const { playlist, access } = loaded;

		const body = await readJsonBody<Body>(request);
		if (!body) return response.error(HttpCodes.BadRequest);
		const { name, description, isPublic } = body;
		if (name !== undefined && typeof name !== 'string') return response.error(HttpCodes.BadRequest);
		if (description !== undefined && description !== null && typeof description !== 'string') return response.error(HttpCodes.BadRequest);
		if (isPublic !== undefined && typeof isPublic !== 'boolean') return response.error(HttpCodes.BadRequest);

		// Each field is checked against its own right before anything is written.
		if ((name !== undefined || description !== undefined) && !access.update) return response.error(HttpCodes.Forbidden, FORBIDDEN);
		if (isPublic !== undefined && !access.manage) return response.error(HttpCodes.Forbidden, FORBIDDEN);

		const result = updatePlaylist(playlist.id, { name, description, isPublic });
		if (!result.ok) return sendPlaylistError(response, result.error);
		return response.json({ ok: true, playlist: await serializeSummary(result.playlist, access, loaded.guild.id) });
	}
}
