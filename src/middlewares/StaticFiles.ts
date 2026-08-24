import { Middleware, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { existsSync } from 'fs';
import { join } from 'path';
import sirv from 'sirv';

const webDistPath = join(process.cwd(), 'dist', 'web');

// Lazily created once dist/web exists, so a bot started before the SPA is
// built picks up static serving on the next request instead of staying
// disabled until a full restart.
let serveStatic: ReturnType<typeof sirv> | null = null;

function getServeStatic() {
	if (serveStatic) return serveStatic;
	if (!existsSync(webDistPath)) return null;
	serveStatic = sirv(webDistPath, { single: true, dev: process.env.NODE_ENV === 'development' });
	return serveStatic;
}

export class StaticFilesMiddleware extends Middleware {
	public constructor(context: Middleware.LoaderContext, options: Middleware.Options) {
		super(context, { ...options, position: 5 });
	}

	public override async run(request: ApiRequest, response: ApiResponse): Promise<void> {
		// Only intercept non-API, non-OAuth requests
		const url = request.url ?? '/';
		if (url.startsWith('/api') || url.startsWith('/oauth') || url.startsWith('/ws')) {
			return;
		}

		const serve = getServeStatic();
		if (!serve) return;

		// Promisify the sirv callback
		await new Promise<void>((resolve) => {
			serve(request as any, response as any, () => {
				// sirv didn't handle it, fall through to routes
				resolve();
			});

			// If sirv handles the response, it will call res.end()
			// We need to detect when the response is finished
			response.once('finish', () => {
				resolve();
			});
		});
	}
}
