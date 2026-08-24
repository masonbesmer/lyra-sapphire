import { db } from './database';

function slugify(name: string): string {
	const base = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50);
	return base || 'server';
}

export function getSlugByGuildId(guildId: string): string | null {
	const row = db.prepare('SELECT slug FROM guild_meta WHERE guild_id = ?').get(guildId) as { slug: string } | undefined;
	return row?.slug ?? null;
}

export function getGuildIdBySlug(slug: string): string | null {
	const row = db.prepare('SELECT guild_id FROM guild_meta WHERE slug = ?').get(slug) as { guild_id: string } | undefined;
	return row?.guild_id ?? null;
}

/** Returns the guild's existing slug, or mints and persists a unique one derived from its name. */
export function getOrCreateSlug(guildId: string, guildName: string): string {
	const existing = getSlugByGuildId(guildId);
	if (existing) return existing;

	const base = slugify(guildName);
	const slugTaken = db.prepare('SELECT 1 FROM guild_meta WHERE slug = ?');

	let candidate = base;
	let suffix = 1;
	while (slugTaken.get(candidate)) {
		candidate = `${base}-${++suffix}`;
	}

	db.prepare('INSERT INTO guild_meta (guild_id, slug) VALUES (?, ?)').run(guildId, candidate);
	return candidate;
}
