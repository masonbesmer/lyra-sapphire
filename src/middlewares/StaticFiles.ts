import { Middleware, type ApiRequest, type ApiResponse, type MimeTypeWithoutParameters } from '@sapphire/plugin-api';
import { existsSync } from 'fs';
import { join } from 'path';
import sirv from 'sirv';

const webDistPath = join(process.cwd(), 'dist', 'web');

// Only serve static files if the dist/web directory exists
const hasWebDist = existsSync(webDistPath);
const serveStatic = hasWebDist ? sirv(webDistPath, { single: true, dev: process.env.NODE_ENV !== 'production' }) : null;

export class StaticFilesMiddleware extends Middleware {
	public constructor(context: Middleware.LoaderContext, options: Middleware.Options) {
		super(context, { ...options, position: 5 });
	}

	public override run(request: ApiRequest, response: ApiResponse): void {
		// Only intercept non-API, non-OAuth requests
		const url = request.url ?? '/';
		if (url.startsWith('/api') || url.startsWith('/oauth') || url.startsWith('/ws')) {
			return;
		}

		if (!serveStatic) return;

		serveStatic(request as any, response as any, () => {
			// Fall through - let other routes handle it
		});
	}
}
