import { describe, expect, it } from 'vitest';
import { getGuildIdBySlug, getOrCreateSlug, getSlugByGuildId } from '../../src/lib/slug';

describe('getOrCreateSlug', () => {
	it('strips diacritics and punctuation', () => {
		expect(getOrCreateSlug('slug-1', 'Café Crew!!')).toBe('cafe-crew');
	});

	it('falls back to "server" for a name with no usable characters', () => {
		expect(getOrCreateSlug('slug-2', '★★★')).toBe('server');
	});

	it('suffixes a colliding slug', () => {
		getOrCreateSlug('slug-3', 'Same Name');
		expect(getOrCreateSlug('slug-4', 'same name')).toBe('same-name-2');
		expect(getOrCreateSlug('slug-5', 'SAME-NAME')).toBe('same-name-3');
	});

	it('returns the existing slug even after a rename', () => {
		const first = getOrCreateSlug('slug-6', 'Original');
		expect(getOrCreateSlug('slug-6', 'Renamed')).toBe(first);
	});

	it('clamps long names to 50 characters', () => {
		expect(getOrCreateSlug('slug-7', 'a'.repeat(80))).toHaveLength(50);
	});
});

describe('slug lookups', () => {
	it('round-trips between guild id and slug', () => {
		const slug = getOrCreateSlug('slug-lookup', 'Lookup Guild');
		expect(getSlugByGuildId('slug-lookup')).toBe(slug);
		expect(getGuildIdBySlug(slug)).toBe('slug-lookup');
	});

	it('returns null for unknown ids and slugs', () => {
		expect(getSlugByGuildId('nobody')).toBeNull();
		expect(getGuildIdBySlug('no-such-slug')).toBeNull();
	});
});
