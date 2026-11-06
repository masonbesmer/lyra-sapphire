import { describe, expect, it } from 'vitest';
import { buildLyricsEmbeds } from '../../src/lib/lyrics';

describe('buildLyricsEmbeds', () => {
	it('splits lyrics into 4096-character embeds', () => {
		const embeds = buildLyricsEmbeds('Song', 'x'.repeat(4096 * 2 + 10));
		expect(embeds.map((embed) => embed.toJSON().description?.length)).toEqual([4096, 4096, 10]);
	});

	it('prefixes the title and clamps it to 256 characters', () => {
		const [short] = buildLyricsEmbeds('Song', 'la la');
		expect(short.toJSON().title).toBe('📜 Song');

		const [long] = buildLyricsEmbeds('t'.repeat(300), 'la la');
		expect(long.toJSON().title).toHaveLength(256);
	});

	it('returns no embeds for empty lyrics', () => {
		expect(buildLyricsEmbeds('Song', '')).toEqual([]);
	});
});
