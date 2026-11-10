import { readdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = join(__dirname, '..', '..', 'src', 'routes');

// The pieces store keys routes by file basename and unloads the earlier piece on a clash, so a
// second `play.post.ts` anywhere under src/routes silently replaces the first route.
describe('route files', () => {
	it('have unique basenames', () => {
		const files = readdirSync(ROUTES_DIR, { recursive: true, encoding: 'utf8' })
			.filter((file) => file.endsWith('.ts') && !basename(file).startsWith('_'))
			.map((file) => join(ROUTES_DIR, file));

		const byName = new Map<string, string[]>();
		for (const file of files) {
			const name = basename(file, extname(file));
			byName.set(name, [...(byName.get(name) ?? []), relative(ROUTES_DIR, file)]);
		}

		expect([...byName.values()].filter((paths) => paths.length > 1)).toEqual([]);
	});
});
