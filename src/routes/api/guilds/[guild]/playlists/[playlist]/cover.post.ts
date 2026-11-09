import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { loadPlaylist } from '../../../_playlists';
import { MAX_COVER_BYTES, setCover, sniffImageMime } from '../../../../../../lib/playlists';

const TOO_LARGE = `Covers can be at most ${MAX_COVER_BYTES / 1024 / 1024} MiB.`;

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, maximumBodyLength: MAX_COVER_BYTES });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'update');
		if (!loaded) return;

		// The body middleware only trusts Content-Length, which a chunked upload does not send.
		const bytes = Buffer.from(await request.readBodyArrayBuffer().catch(() => new ArrayBuffer(0)));
		if (bytes.byteLength > MAX_COVER_BYTES) return response.error(HttpCodes.PayloadTooLarge, TOO_LARGE);
		if (!bytes.byteLength) return response.error(HttpCodes.BadRequest, 'Pick an image to upload.');

		const mime = sniffImageMime(bytes);
		if (!mime) return response.error(HttpCodes.UnsupportedMediaType, 'Covers have to be PNG, JPEG, GIF or WEBP images.');

		setCover(loaded.playlist.id, bytes, mime);
		return response.json({ ok: true });
	}
}
