import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { readJsonBody } from '../../../_helpers';
import { loadPlaylist } from '../../../_playlists';
import { addTracks, MAX_TRACKS_PER_PLAYLIST, type NewTrack } from '../../../../../../lib/playlists';
import { currentTrack, resolveTracksForQuery, toNewTrack } from '../../../../../../lib/playlistPlayback';

interface Body {
	query?: unknown;
	nowPlaying?: unknown;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'create');
		if (!loaded) return;
		const { guild, member, playlist } = loaded;

		const body = await readJsonBody<Body>(request);
		let tracks: NewTrack[];
		if (body?.nowPlaying === true) {
			const current = currentTrack(guild.id);
			if (!current) return response.json({ ok: false, error: "nothing's playing right now." });
			tracks = [toNewTrack(current)];
		} else if (typeof body?.query === 'string' && body.query.trim()) {
			try {
				tracks = await resolveTracksForQuery(body.query.trim(), member.user);
			} catch (e) {
				container.logger.error(`[playlist] search: ${String(e)}`);
				return response.error(HttpCodes.InternalServerError, 'The search failed - check the bot logs.');
			}
			if (!tracks.length) return response.json({ ok: false, error: 'No results found' });
		} else {
			return response.error(HttpCodes.BadRequest, 'Search for a track to add.');
		}

		// The search can take seconds, long enough for the playlist to be deleted or the grant revoked.
		if (!(await loadPlaylist(request, response, 'create'))) return;
		const result = addTracks(playlist.id, tracks, member.id);
		if (!result.ok && result.error === 'not_found') return response.error(HttpCodes.NotFound, "That playlist doesn't exist anymore.");
		if (!result.ok && result.error === 'expiring')
			return response.error(HttpCodes.BadRequest, "Uploaded files can't go in a playlist: Discord's link to them expires.");
		if (!result.ok) return response.error(HttpCodes.BadRequest, `That would put more than ${MAX_TRACKS_PER_PLAYLIST} tracks in the playlist.`);
		return response.json({ ok: true, added: result.added });
	}
}
