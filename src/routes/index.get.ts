import { Route } from '@sapphire/plugin-api';
import { readFileSync } from 'fs';
import { join } from 'path';

export class UserRoute extends Route {
	public override run(_request: Route.Request, response: Route.Response) {
		try {
			const indexPath = join(process.cwd(), 'dist', 'web', 'index.html');
			const html = readFileSync(indexPath, 'utf-8');
			response.setHeader('Content-Type', 'text/html');
			response.end(html);
		} catch (error) {
			// Only send error response if headers haven't been sent yet
			if (!response.headersSent) {
				response.json({ message: 'Landing Page - Svelte app not built yet' });
			}
		}
	}
}
