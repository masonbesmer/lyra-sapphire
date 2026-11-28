import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { loadPlaylist } from '../../../_playlists';
import { MAX_ATTACHMENT_BYTES, safeDisplayName } from '../../../../../../lib/attachmentAudio';
import { addTracks, MAX_TRACKS_PER_PLAYLIST } from '../../../../../../lib/playlists';
import { ingestStream } from '../../../../../../lib/playlistMedia';
import { trackForStoredFile } from '../../../../../../lib/playlistPlayback';

/**
 * Uploads one audio file into a playlist from the dashboard. The body is the raw file and the
 * `name` query parameter its filename (for the extension and the title). The body is streamed
 * straight to disk rather than buffered, since it can be up to MAX_ATTACHMENT_BYTES.
 */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, maximumBodyLength: MAX_ATTACHMENT_BYTES });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'create');
		if (!loaded) return;
		const { guild, member, playlist } = loaded;

		const name = typeof request.query.name === 'string' ? request.query.name : '';
		const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
		if (!extension) return response.error(HttpCodes.BadRequest, 'The file needs an extension, like .mp3.');
		if (playlist.trackCount >= MAX_TRACKS_PER_PLAYLIST) {
			return response.error(HttpCodes.BadRequest, `That playlist already has ${MAX_TRACKS_PER_PLAYLIST} tracks.`);
		}

		const title = safeDisplayName(name);
		const length = Number(request.headers['content-length']);
		let saved;
		try {
			const ingested = await ingestStream(request, {
				extension,
				uploaderId: member.id,
				guildId: guild.id,
				declaredBytes: Number.isFinite(length) && length > 0 ? length : null
			});
			saved = ingested.ok ? await trackForStoredFile(ingested.file, title) : ingested;
		} catch (e) {
			container.logger.error(`[playlist] upload: ${String(e)}`);
			return response.error(HttpCodes.InternalServerError, 'The upload failed - check the bot logs.');
		}
		if (!saved.ok) return response.error(HttpCodes.BadRequest, `${title}: ${saved.reason}.`);

		// The upload can take a while, long enough for the playlist to be deleted or the grant revoked.
		if (!(await loadPlaylist(request, response, 'create'))) return;
		const result = addTracks(playlist.id, [saved.track], member.id);
		if (!result.ok && result.error === 'not_found') return response.error(HttpCodes.NotFound, "That playlist doesn't exist anymore.");
		if (!result.ok) return response.error(HttpCodes.BadRequest, `That would put more than ${MAX_TRACKS_PER_PLAYLIST} tracks in the playlist.`);
		return response.json({ ok: true, added: 1, title: saved.track.title });
	}
}
