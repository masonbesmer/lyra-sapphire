import type { Guild } from 'discord.js';
import { db } from './database';

export const MAX_PLAYLISTS_PER_OWNER = 100;
export const MAX_TRACKS_PER_PLAYLIST = 500;
export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 300;
export const MAX_COVER_BYTES = 1024 * 1024;
export const MAX_REPEAT = 10;
export const MAX_TRACKS_PER_PLAY = 1000;

export interface Playlist {
	id: number;
	ownerId: string;
	name: string;
	description: string | null;
	isPublic: boolean;
	coverMime: CoverMime | null;
	coverUpdatedAt: string | null;
	trackCount: number;
	totalLengthMs: number;
}

export interface PlaylistTrack {
	id: number;
	/** 0-based and dense within its playlist. */
	position: number;
	title: string;
	uri: string | null;
	author: string | null;
	lengthMs: number;
	source: string | null;
	rawJson: string;
	addedBy: string;
}

export type NewTrack = Pick<PlaylistTrack, 'title' | 'uri' | 'author' | 'lengthMs' | 'source' | 'rawJson'>;

export interface GrantFlags {
	create: boolean;
	read: boolean;
	update: boolean;
	delete: boolean;
}

export interface PlaylistGrant extends GrantFlags {
	userId: string;
}

/**
 * read: view, play, fetch the cover. create: add tracks. update: reorder, rename, describe,
 * change the cover. delete: remove tracks. manage: visibility, grants and deleting the whole
 * playlist — owner only, so a grantee can never widen their own rights or destroy the owner's data.
 */
export type PlaylistRight = 'read' | 'create' | 'update' | 'delete' | 'manage';
export type PlaylistAccess = Record<PlaylistRight, boolean>;

// ── Rows ─────────────────────────────────────────────────────────────────────

interface PlaylistRow {
	id: number;
	owner_id: string;
	name: string;
	description: string | null;
	is_public: 0 | 1;
	cover_mime: CoverMime | null;
	cover_updated_at: string | null;
	track_count: number;
	total_length_ms: number;
}

interface TrackRow {
	id: number;
	position: number;
	title: string;
	uri: string | null;
	author: string | null;
	length_ms: number;
	source: string | null;
	raw_json: string;
	added_by: string;
}

interface GrantRow {
	user_id: string;
	can_create: 0 | 1;
	can_read: 0 | 1;
	can_update: 0 | 1;
	can_delete: 0 | 1;
}

// Never selects cover_image: listings would otherwise drag up to a megabyte per playlist along.
const SELECT_PLAYLIST = `
	SELECT p.id, p.owner_id, p.name, p.description, p.is_public, p.cover_mime, p.cover_updated_at,
		(SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS track_count,
		(SELECT COALESCE(SUM(t.length_ms), 0) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS total_length_ms
	FROM playlists p`;

function toPlaylist(row: PlaylistRow): Playlist {
	return {
		id: row.id,
		ownerId: row.owner_id,
		name: row.name,
		description: row.description,
		isPublic: row.is_public === 1,
		coverMime: row.cover_mime,
		coverUpdatedAt: row.cover_updated_at,
		trackCount: row.track_count,
		totalLengthMs: row.total_length_ms
	};
}

function toTrack(row: TrackRow): PlaylistTrack {
	return {
		id: row.id,
		position: row.position,
		title: row.title,
		uri: row.uri,
		author: row.author,
		lengthMs: row.length_ms,
		source: row.source,
		rawJson: row.raw_json,
		addedBy: row.added_by
	};
}

function toGrant(row: GrantRow): PlaylistGrant {
	return {
		userId: row.user_id,
		create: row.can_create === 1,
		read: row.can_read === 1,
		update: row.can_update === 1,
		delete: row.can_delete === 1
	};
}

const now = () => new Date().toISOString();

function touch(playlistId: number): void {
	db.prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`).run(now(), playlistId);
}

// ── Playlists ────────────────────────────────────────────────────────────────

export type NameError = 'invalid_name' | 'duplicate';

function normalizeName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > MAX_NAME_LENGTH || /[\r\n]/.test(trimmed)) return null;
	return trimmed;
}

function normalizeDescription(description: string | null | undefined): string | null {
	const trimmed = description?.trim().slice(0, MAX_DESCRIPTION_LENGTH);
	return trimmed || null;
}

function isUniqueViolation(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export function getPlaylist(id: number): Playlist | null {
	const row = db.prepare(`${SELECT_PLAYLIST} WHERE p.id = ?`).get(id) as PlaylistRow | undefined;
	return row ? toPlaylist(row) : null;
}

export function createPlaylist(
	ownerId: string,
	input: { name: string; description?: string | null; isPublic?: boolean }
): { ok: true; playlist: Playlist } | { ok: false; error: NameError | 'limit' } {
	const name = normalizeName(input.name);
	if (!name) return { ok: false, error: 'invalid_name' };

	const { count } = db.prepare(`SELECT COUNT(*) AS count FROM playlists WHERE owner_id = ?`).get(ownerId) as { count: number };
	if (count >= MAX_PLAYLISTS_PER_OWNER) return { ok: false, error: 'limit' };

	try {
		const timestamp = now();
		const { lastInsertRowid } = db
			.prepare(`INSERT INTO playlists (owner_id, name, description, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
			.run(ownerId, name, normalizeDescription(input.description), input.isPublic ? 1 : 0, timestamp, timestamp);
		return { ok: true, playlist: getPlaylist(Number(lastInsertRowid))! };
	} catch (error) {
		if (isUniqueViolation(error)) return { ok: false, error: 'duplicate' };
		throw error;
	}
}

export function updatePlaylist(
	id: number,
	patch: { name?: string; description?: string | null; isPublic?: boolean }
): { ok: true; playlist: Playlist } | { ok: false; error: NameError } {
	const sets: string[] = [];
	const values: (string | number | null)[] = [];

	if (patch.name !== undefined) {
		const name = normalizeName(patch.name);
		if (!name) return { ok: false, error: 'invalid_name' };
		sets.push('name = ?');
		values.push(name);
	}
	if (patch.description !== undefined) {
		sets.push('description = ?');
		values.push(normalizeDescription(patch.description));
	}
	if (patch.isPublic !== undefined) {
		sets.push('is_public = ?');
		values.push(patch.isPublic ? 1 : 0);
	}

	try {
		db.prepare(`UPDATE playlists SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`).run(...values, now(), id);
	} catch (error) {
		if (isUniqueViolation(error)) return { ok: false, error: 'duplicate' };
		throw error;
	}
	return { ok: true, playlist: getPlaylist(id)! };
}

export const deletePlaylist: (id: number) => void = db.transaction((id: number): void => {
	db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(id);
	db.prepare(`DELETE FROM playlist_grants WHERE playlist_id = ?`).run(id);
	db.prepare(`DELETE FROM playlists WHERE id = ?`).run(id);
});

function listPlaylists(where: string, ...params: (string | number)[]): Playlist[] {
	return (db.prepare(`${SELECT_PLAYLIST} ${where} ORDER BY p.name COLLATE NOCASE`).all(...params) as PlaylistRow[]).map(toPlaylist);
}

export function listOwned(ownerId: string): Playlist[] {
	return listPlaylists(`WHERE p.owner_id = ?`, ownerId);
}

export function listGrantedTo(userId: string, right?: Exclude<PlaylistRight, 'read' | 'manage'>): Playlist[] {
	const flag = right ? ` AND g.can_${right} = 1` : '';
	return listPlaylists(`JOIN playlist_grants g ON g.playlist_id = p.id WHERE g.user_id = ?${flag}`, userId);
}

function listPublicExcept(ownerId: string): Playlist[] {
	return listPlaylists(`WHERE p.is_public = 1 AND p.owner_id != ?`, ownerId);
}

// ── Tracks ───────────────────────────────────────────────────────────────────

export function listTracks(playlistId: number): PlaylistTrack[] {
	return (db.prepare(`SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`).all(playlistId) as TrackRow[]).map(toTrack);
}

type AddTracksResult = { ok: true; added: number } | { ok: false; error: 'full' };

export const addTracks: (playlistId: number, tracks: NewTrack[], addedBy: string) => AddTracksResult = db.transaction(
	(playlistId: number, tracks: NewTrack[], addedBy: string): AddTracksResult => {
		const { count } = db.prepare(`SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ?`).get(playlistId) as { count: number };
		if (count + tracks.length > MAX_TRACKS_PER_PLAYLIST) return { ok: false, error: 'full' };

		const insert = db.prepare(
			`INSERT INTO playlist_tracks (playlist_id, position, title, uri, author, length_ms, source, raw_json, added_by, added_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const timestamp = now();
		tracks.forEach((track, i) =>
			insert.run(playlistId, count + i, track.title, track.uri, track.author, track.lengthMs, track.source, track.rawJson, addedBy, timestamp)
		);
		touch(playlistId);
		return { ok: true, added: tracks.length };
	}
);

export const removeTrack: (playlistId: number, trackId: number) => boolean = db.transaction((playlistId: number, trackId: number): boolean => {
	const row = db.prepare(`SELECT position FROM playlist_tracks WHERE id = ? AND playlist_id = ?`).get(trackId, playlistId) as
		{ position: number } | undefined;
	if (!row) return false;

	db.prepare(`DELETE FROM playlist_tracks WHERE id = ?`).run(trackId);
	db.prepare(`UPDATE playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ?`).run(playlistId, row.position);
	touch(playlistId);
	return true;
});

/** Positions are 0-based. Returns false when either is out of range. */
export const moveTrack: (playlistId: number, from: number, to: number) => boolean = db.transaction(
	(playlistId: number, from: number, to: number): boolean => {
		const { count } = db.prepare(`SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ?`).get(playlistId) as { count: number };
		const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n < count;
		if (!inRange(from) || !inRange(to)) return false;
		if (from === to) return true;

		const { id } = db.prepare(`SELECT id FROM playlist_tracks WHERE playlist_id = ? AND position = ?`).get(playlistId, from) as { id: number };
		if (from < to) {
			db.prepare(`UPDATE playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ? AND position <= ?`).run(
				playlistId,
				from,
				to
			);
		} else {
			db.prepare(`UPDATE playlist_tracks SET position = position + 1 WHERE playlist_id = ? AND position >= ? AND position < ?`).run(
				playlistId,
				to,
				from
			);
		}
		db.prepare(`UPDATE playlist_tracks SET position = ? WHERE id = ?`).run(to, id);
		touch(playlistId);
		return true;
	}
);

// ── Covers ───────────────────────────────────────────────────────────────────

export type CoverMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Identifies the image by its leading bytes, never by a client-supplied Content-Type. Anything
 * else — SVG above all, since it can carry script — is refused.
 */
export function sniffImageMime(bytes: Uint8Array): CoverMime | null {
	const startsWith = (signature: number[], offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
	const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

	if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWith(ascii('GIF87a')) || startsWith(ascii('GIF89a'))) return 'image/gif';
	if (startsWith(ascii('RIFF')) && startsWith(ascii('WEBP'), 8)) return 'image/webp';
	return null;
}

export function setCover(playlistId: number, bytes: Buffer, mime: CoverMime): void {
	const timestamp = now();
	db.prepare(`UPDATE playlists SET cover_image = ?, cover_mime = ?, cover_updated_at = ?, updated_at = ? WHERE id = ?`).run(
		bytes,
		mime,
		timestamp,
		timestamp,
		playlistId
	);
}

export function clearCover(playlistId: number): void {
	db.prepare(`UPDATE playlists SET cover_image = NULL, cover_mime = NULL, cover_updated_at = NULL, updated_at = ? WHERE id = ?`).run(
		now(),
		playlistId
	);
}

export function getCover(playlistId: number): { bytes: Buffer; mime: CoverMime } | null {
	const row = db.prepare(`SELECT cover_image, cover_mime FROM playlists WHERE id = ?`).get(playlistId) as
		{ cover_image: Buffer | null; cover_mime: CoverMime | null } | undefined;
	return row?.cover_image && row.cover_mime ? { bytes: row.cover_image, mime: row.cover_mime } : null;
}

// ── Grants ───────────────────────────────────────────────────────────────────

export function getGrant(playlistId: number, userId: string): PlaylistGrant | null {
	const row = db.prepare(`SELECT * FROM playlist_grants WHERE playlist_id = ? AND user_id = ?`).get(playlistId, userId) as GrantRow | undefined;
	return row ? toGrant(row) : null;
}

export function listGrants(playlistId: number): PlaylistGrant[] {
	return (db.prepare(`SELECT * FROM playlist_grants WHERE playlist_id = ? ORDER BY granted_at`).all(playlistId) as GrantRow[]).map(toGrant);
}

export function upsertGrant(playlistId: number, userId: string, flags: GrantFlags, grantedBy: string): PlaylistGrant {
	db.prepare(
		`INSERT INTO playlist_grants (playlist_id, user_id, can_create, can_read, can_update, can_delete, granted_by, granted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (playlist_id, user_id) DO UPDATE SET
			can_create = excluded.can_create, can_read = excluded.can_read, can_update = excluded.can_update,
			can_delete = excluded.can_delete, granted_by = excluded.granted_by, granted_at = excluded.granted_at`
	).run(playlistId, userId, +flags.create, +flags.read, +flags.update, +flags.delete, grantedBy, now());
	return getGrant(playlistId, userId)!;
}

export function revokeGrant(playlistId: number, userId: string): boolean {
	return db.prepare(`DELETE FROM playlist_grants WHERE playlist_id = ? AND user_id = ?`).run(playlistId, userId).changes > 0;
}

// ── Access ───────────────────────────────────────────────────────────────────

/** The one guild capability access checks need, so tests can fake it without a whole Guild. */
export type MemberLookup = Pick<Guild, 'members'>;

/**
 * Any grant implies read: a right to edit a playlist you cannot see is not coherent. A public
 * playlist is readable only from a guild its owner is also in — the rule that keeps "public"
 * from meaning "visible to every Discord user who shares any server with the bot".
 */
export function computeAccess(playlist: Playlist, viewerId: string, grant: GrantFlags | null, ownerSharesGuild: boolean): PlaylistAccess {
	if (playlist.ownerId === viewerId) return { read: true, create: true, update: true, delete: true, manage: true };

	const granted = grant ?? { create: false, read: false, update: false, delete: false };
	const anyGrant = granted.create || granted.read || granted.update || granted.delete;
	return {
		read: anyGrant || (playlist.isPublic && ownerSharesGuild),
		create: granted.create,
		update: granted.update,
		delete: granted.delete,
		manage: false
	};
}

async function isMember(guild: MemberLookup, userId: string): Promise<boolean> {
	return guild.members.fetch(userId).then(
		() => true,
		() => false
	);
}

export type AuthorizeResult =
	| { ok: true; playlist: Playlist; access: PlaylistAccess }
	/** Missing and unreadable look the same, so a private playlist never leaks its existence. */
	| { ok: false; reason: 'not_found' }
	| { ok: false; reason: 'forbidden'; access: PlaylistAccess };

/**
 * The single authorization gate for playlists. Both the /playlist command and every playlist
 * API route call it, so the UI's own checks are only cosmetic. `guild` is the guild the request
 * arrived through; the caller has already established the viewer is a member of it.
 */
export async function authorizePlaylist(guild: MemberLookup, viewerId: string, playlistId: number, need: PlaylistRight): Promise<AuthorizeResult> {
	const playlist = getPlaylist(playlistId);
	if (!playlist) return { ok: false, reason: 'not_found' };

	const grant = playlist.ownerId === viewerId ? null : getGrant(playlistId, viewerId);
	let access = computeAccess(playlist, viewerId, grant, false);
	// Only a public playlist read by a non-grantee depends on where the owner is.
	if (!access.read && playlist.isPublic) {
		access = computeAccess(playlist, viewerId, grant, await isMember(guild, playlist.ownerId));
	}

	if (!access.read) return { ok: false, reason: 'not_found' };
	if (!access[need]) return { ok: false, reason: 'forbidden', access };
	return { ok: true, playlist, access };
}

export interface VisiblePlaylist {
	playlist: Playlist;
	access: PlaylistAccess;
}

/** Each playlist appears in exactly one section; owned wins over shared, shared over public. */
export async function listVisiblePlaylists(
	guild: MemberLookup,
	viewerId: string
): Promise<{ owned: VisiblePlaylist[]; shared: VisiblePlaylist[]; public: VisiblePlaylist[] }> {
	const owned = listOwned(viewerId).map((playlist) => ({ playlist, access: computeAccess(playlist, viewerId, null, true) }));

	const shared = listGrantedTo(viewerId).map((playlist) => ({
		playlist,
		access: computeAccess(playlist, viewerId, getGrant(playlist.id, viewerId), false)
	}));
	const sharedIds = new Set(shared.map(({ playlist }) => playlist.id));

	const candidates = listPublicExcept(viewerId).filter((playlist) => !sharedIds.has(playlist.id));
	const ownerIds = [...new Set(candidates.map((playlist) => playlist.ownerId))];
	const present = new Set((await Promise.all(ownerIds.map(async (id) => ((await isMember(guild, id)) ? id : null)))).filter(Boolean));
	const publicInGuild = candidates
		.filter((playlist) => present.has(playlist.ownerId))
		.map((playlist) => ({ playlist, access: computeAccess(playlist, viewerId, null, true) }));

	return { owned, shared, public: publicInGuild };
}

/** Owned playlists plus those granted with `right` — the targets for adding, removing or reordering. */
export function listWritablePlaylists(userId: string, right: Exclude<PlaylistRight, 'read' | 'manage'>): Playlist[] {
	return [...listOwned(userId), ...listGrantedTo(userId, right)];
}
