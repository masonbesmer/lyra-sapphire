import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { isMediaFileName, PLAYLIST_MEDIA_DIR } from '../../lib/playlistMedia';
import { MEDIA_DIR } from '../../lib/soundcloud';

const MIME: Record<string, string> = {
	aac: 'audio/aac',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
	m4b: 'audio/mp4',
	mka: 'audio/x-matroska',
	mp3: 'audio/mpeg',
	oga: 'audio/ogg',
	ogg: 'audio/ogg',
	opus: 'audio/ogg',
	wav: 'audio/wav',
	webm: 'audio/webm'
};

/** SoundCloud downloads: 128 random bits. */
const SOUNDCLOUD_FILE = /^[0-9a-f]{32}\.(mp3|m4a|ogg)$/;

/**
 * Serves audio the bot keeps to Lavalink's http source: SoundCloud downloads (lib/soundcloud.ts)
 * and uploads saved in playlists (lib/playlistMedia.ts, named by SHA-256). Names are matched
 * exactly against those two shapes, so nothing else in either directory, or outside them, is
 * reachable. Range support is what lets Lavalink seek.
 */
export class UserRoute extends Route {
	public override async run(request: ApiRequest, response: ApiResponse) {
		const name = String(request.params.file ?? '');
		const dir = SOUNDCLOUD_FILE.test(name) ? MEDIA_DIR : isMediaFileName(name) ? PLAYLIST_MEDIA_DIR : null;
		if (!dir) return response.error(HttpCodes.NotFound, 'Not found.');
		const extension = name.slice(name.lastIndexOf('.') + 1);

		const path = join(dir, name);
		const info = await stat(path).catch(() => null);
		if (!info?.isFile()) return response.error(HttpCodes.NotFound, 'Not found.');

		const size = info.size;
		let start = 0;
		let end = size - 1;
		const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
		if (range && (range[1] || range[2])) {
			if (range[1]) {
				start = Number(range[1]);
				if (range[2]) end = Math.min(Number(range[2]), size - 1);
			} else {
				start = Math.max(size - Number(range[2]), 0);
			}
			if (start > end || start >= size) {
				response.setHeader('Content-Range', `bytes */${size}`);
				response.statusCode = 416;
				return response.end();
			}
			response.statusCode = 206;
			response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
		} else {
			response.statusCode = 200;
		}

		response.setHeader('Content-Type', MIME[extension] ?? 'application/octet-stream');
		response.setHeader('Content-Length', String(end - start + 1));
		response.setHeader('Accept-Ranges', 'bytes');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		if (request.method === 'HEAD') return response.end();
		createReadStream(path, { start, end }).pipe(response);
	}
}
