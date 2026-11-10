import { describe, expectTypeOf, it } from 'vitest';
import type { PlaylistSummary, serializeDetail } from '../../src/routes/api/guilds/_playlists';
import type { PlaylistDetail as WebDetail, PlaylistSummary as WebSummary } from '../../web/src/lib/types.js' with { 'resolution-mode': 'import' };

// The dashboard keeps its own copies of the response types it reads from the server.
describe('dashboard playlist contract', () => {
	it('reads only fields the server sends', () => {
		expectTypeOf<PlaylistSummary>().toExtend<WebSummary>();
		expectTypeOf<Awaited<ReturnType<typeof serializeDetail>>>().toExtend<WebDetail>();
	});
});
