import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { readJsonBody, resolveGuild } from '../_helpers';
import { sendPlaylistError, serializeSummary } from '../_playlists';
import { computeAccess, createPlaylist } from '../../../../lib/playlists';

interface Body {
	name?: unknown;
	description?: unknown;
	isPublic?: unknown;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;

		const body = await readJsonBody<Body>(request);
		if (typeof body?.name !== 'string') return response.error(HttpCodes.BadRequest, 'Give the playlist a name.');
		if (body.description !== undefined && body.description !== null && typeof body.description !== 'string')
			return response.error(HttpCodes.BadRequest);
		if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') return response.error(HttpCodes.BadRequest);

		const ownerId = request.auth!.id;
		const result = createPlaylist(ownerId, { name: body.name, description: body.description, isPublic: body.isPublic });
		if (!result.ok) return sendPlaylistError(response, result.error);

		const access = computeAccess(result.playlist, ownerId, null, true);
		return response.json({ ok: true, playlist: await serializeSummary(result.playlist, access, resolved.guild.id) });
	}
}
