import { describe, expect, expectTypeOf, it } from 'vitest';
import { MAX_COVER_BYTES, MAX_REPEAT } from '../../src/lib/playlists';
import type { PlaylistSummary, serializeDetail } from '../../src/routes/api/guilds/_playlists';
import type { PlaylistDetail as WebDetail, PlaylistSummary as WebSummary } from '../../web/src/lib/types.js' with { 'resolution-mode': 'import' };

// The dashboard cannot import from src/, so it keeps its own copies of what it reads from the server.
describe('dashboard playlist contract', () => {
	it('uses the server limits', async () => {
		const web = await import('../../web/src/lib/playlistLimits.js');
		expect({ MAX_COVER_BYTES: web.MAX_COVER_BYTES, MAX_REPEAT: web.MAX_REPEAT }).toEqual({ MAX_COVER_BYTES, MAX_REPEAT });
	});

	it('reads only fields the server sends', () => {
		expectTypeOf<PlaylistSummary>().toExtend<WebSummary>();
		expectTypeOf<Awaited<ReturnType<typeof serializeDetail>>>().toExtend<WebDetail>();
	});
});
