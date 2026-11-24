import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { MEDIA_DIR } from '../../lib/soundcloud';

const MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' };

/**
 * Serves audio the bot downloaded (see lib/soundcloud.ts) to Lavalink's http source. Names are
 * 128 random bits and matched exactly, so nothing else in the directory, or outside it, is
 * reachable. Range support is what lets Lavalink seek.
 */
export class UserRoute extends Route {
	public override async run(request: ApiRequest, response: ApiResponse) {
		const name = String(request.params.file ?? '');
		const match = /^[0-9a-f]{32}\.(mp3|m4a|ogg)$/.exec(name);
		if (!match) return response.error(HttpCodes.NotFound, 'Not found.');

		const path = join(MEDIA_DIR, name);
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

		response.setHeader('Content-Type', MIME[match[1]!]!);
		response.setHeader('Content-Length', String(end - start + 1));
		response.setHeader('Accept-Ranges', 'bytes');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		if (request.method === 'HEAD') return response.end();
		createReadStream(path, { start, end }).pipe(response);
	}
}
