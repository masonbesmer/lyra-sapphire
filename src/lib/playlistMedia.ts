import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { container } from '@sapphire/framework';
import type { Attachment, User } from 'discord.js';
import type { Kazagumo, KazagumoTrack } from 'kazagumo';
import {
	ALLOWED_EXTENSIONS,
	DISCORD_CDN_HOSTS,
	formatBytes,
	isAudioSignature,
	MAX_ATTACHMENT_BYTES,
	SNIFF_BYTES,
	validateAudioAttachment
} from './attachmentAudio';
import { db } from './database';
import type { NewTrack } from './playlists';
import { mediaBaseUrl } from './soundcloud';

/**
 * Uploaded audio kept on disk so it can live in a playlist.
 *
 * A Discord attachment URL is signed and stops working about a day after it is fetched, so a
 * playlist can't just store the link. Instead the bytes are copied next to the database (the
 * persistent data volume in prod), named by their SHA-256 so the same file is stored once, and
 * served to Lavalink from /media like the SoundCloud downloads. Every stored file counts against
 * the quota of whoever uploaded it first and the guild it was uploaded in. A file goes away once
 * no playlist track points at it any more.
 */

export const MAX_MEDIA_BYTES_PER_USER = 500 * 1024 * 1024;
export const MAX_MEDIA_BYTES_PER_GUILD = 2 * 1024 * 1024 * 1024;

/** A file this new is never pruned, so an upload isn't removed before its track is saved. */
const PRUNE_GRACE_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

// `||`: compose passes an unset variable through as the empty string.
export const PLAYLIST_MEDIA_DIR = process.env.PLAYLIST_MEDIA_DIR || join(dirname(db.name), 'playlist-media');

const FILE_NAME = /^[0-9a-f]{64}\.([a-z0-9]{2,4})$/;

/** `<sha256>.<allowed audio extension>`: the only names that are ever written or served. */
export function isMediaFileName(name: string): boolean {
	const match = FILE_NAME.exec(name);
	return match !== null && ALLOWED_EXTENSIONS.has(match[1]!);
}

export function mediaUrl(file: string): string {
	return `${mediaBaseUrl()}/media/${file}`;
}

export type IngestResult = { ok: true; file: string; bytes: number } | { ok: false; reason: string };

interface IngestOptions {
	/** Lower-case, without the dot. */
	extension: string;
	uploaderId: string;
	guildId: string;
	/** What the sender says the size is; checked up front so an obviously oversized file isn't downloaded. */
	declaredBytes?: number | null;
}

const now = () => new Date().toISOString();

function usedBy(column: 'uploaded_by' | 'guild_id', id: string): number {
	return (db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS used FROM playlist_media WHERE ${column} = ?`).get(id) as { used: number }).used;
}

/** Null when `bytes` more fits both the uploader's and the guild's quota. */
export function quotaProblem(uploaderId: string, guildId: string, bytes: number): string | null {
	const user = usedBy('uploaded_by', uploaderId);
	if (user + bytes > MAX_MEDIA_BYTES_PER_USER) {
		return `that's over your ${formatBytes(MAX_MEDIA_BYTES_PER_USER)} limit for files in playlists (${formatBytes(user)} used). remove some uploaded tracks first.`;
	}
	const guild = usedBy('guild_id', guildId);
	if (guild + bytes > MAX_MEDIA_BYTES_PER_GUILD) {
		return `that's over this server's ${formatBytes(MAX_MEDIA_BYTES_PER_GUILD)} limit for files in playlists (${formatBytes(guild)} used).`;
	}
	return null;
}

export function mediaUsage(uploaderId: string, guildId: string) {
	return {
		user: { used: usedBy('uploaded_by', uploaderId), limit: MAX_MEDIA_BYTES_PER_USER },
		guild: { used: usedBy('guild_id', guildId), limit: MAX_MEDIA_BYTES_PER_GUILD }
	};
}

/**
 * Records the file, or refreshes an existing record so the pruner leaves it alone while its track is
 * saved. One synchronous transaction, so two uploads can't both squeeze under the same quota.
 */
const claim: (file: string, bytes: number, uploaderId: string, guildId: string) => { ok: true; existed: boolean } | { ok: false; reason: string } =
	db.transaction((file: string, bytes: number, uploaderId: string, guildId: string) => {
		if (db.prepare(`UPDATE playlist_media SET created_at = ? WHERE file = ?`).run(now(), file).changes) {
			return { ok: true as const, existed: true };
		}
		const problem = quotaProblem(uploaderId, guildId, bytes);
		if (problem) return { ok: false as const, reason: problem };
		db.prepare(`INSERT INTO playlist_media (file, size_bytes, uploaded_by, guild_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(
			file,
			bytes,
			uploaderId,
			guildId,
			now()
		);
		return { ok: true as const, existed: false };
	});

/** Marks an already-stored file as in use right now, for a track saved again from the queue. */
export function touchMedia(file: string): boolean {
	return db.prepare(`UPDATE playlist_media SET created_at = ? WHERE file = ?`).run(now(), file).changes > 0;
}

/**
 * Streams audio to disk, hashing as it goes. Refuses anything over the size cap, anything whose
 * leading bytes aren't an audio container (the same check /play-file makes, and for the same
 * reason: lavaplayer would happily read a renamed M3U and fetch what it lists), and anything over
 * quota. A duplicate of a stored file costs nothing.
 */
export async function ingestStream(source: AsyncIterable<Uint8Array>, options: IngestOptions): Promise<IngestResult> {
	const extension = options.extension.toLowerCase();
	if (!ALLOWED_EXTENSIONS.has(extension)) return { ok: false, reason: `\`.${extension.slice(0, 12)}\` isn't an audio format I take` };
	// Quota waits for the hash: a copy of a file that's already stored costs nothing, even at the limit.
	if (options.declaredBytes != null && options.declaredBytes > MAX_ATTACHMENT_BYTES) return { ok: false, reason: tooBig(options.declaredBytes) };

	await mkdir(PLAYLIST_MEDIA_DIR, { recursive: true });
	const temp = join(PLAYLIST_MEDIA_DIR, `.${randomBytes(8).toString('hex')}.part`);
	const hash = createHash('sha256');
	const head: Buffer[] = [];
	let headBytes = 0;
	let bytes = 0;

	const handle = await open(temp, 'w');
	try {
		for await (const chunk of source) {
			bytes += chunk.byteLength;
			if (bytes > MAX_ATTACHMENT_BYTES) return await discard(temp, { ok: false, reason: tooBig(bytes) });
			if (headBytes < SNIFF_BYTES) {
				head.push(Buffer.from(chunk.subarray(0, SNIFF_BYTES - headBytes)));
				headBytes += Math.min(chunk.byteLength, SNIFF_BYTES - headBytes);
			}
			hash.update(chunk);
			await handle.write(chunk);
		}
	} catch (error) {
		await discard(temp, null);
		throw error;
	} finally {
		await handle.close().catch(() => {});
	}

	if (!bytes) return discard(temp, { ok: false, reason: 'that file is empty' });
	if (!isAudioSignature(Buffer.concat(head))) return discard(temp, { ok: false, reason: "the contents aren't audio, whatever it's named" });

	const file = `${hash.digest('hex')}.${extension}`;
	const claimed = claim(file, bytes, options.uploaderId, options.guildId);
	if (!claimed.ok) return discard(temp, claimed);

	const target = join(PLAYLIST_MEDIA_DIR, file);
	// A duplicate keeps the copy already there, unless that went missing from disk somehow.
	if (claimed.existed && (await stat(target).catch(() => null))?.isFile()) await rm(temp, { force: true });
	else await rename(temp, target);
	return { ok: true, file, bytes };
}

async function discard<T>(temp: string, result: T): Promise<T> {
	await rm(temp, { force: true }).catch(() => {});
	return result;
}

function tooBig(bytes: number): string {
	return `too big (${formatBytes(bytes)}, limit ${formatBytes(MAX_ATTACHMENT_BYTES)})`;
}

function extensionOf(pathname: string): string {
	const name = pathname.split('/').pop() ?? '';
	return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

/**
 * Copies a Discord upload. Only Discord's CDN is fetched: the URL can come from a track already
 * in the queue, and fetching anything else here would make the bot an open URL fetcher.
 */
export async function ingestFromDiscordCdn(url: string, options: Omit<IngestOptions, 'extension'>): Promise<IngestResult> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { ok: false, reason: 'unreadable file link' };
	}
	if (parsed.protocol !== 'https:' || !DISCORD_CDN_HOSTS.has(parsed.hostname)) return { ok: false, reason: 'not hosted on Discord' };

	let response: Response;
	try {
		response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
	} catch (error) {
		container.logger.warn(`[playlistMedia] download failed: ${String(error)}`);
		return { ok: false, reason: "couldn't download it from Discord" };
	}
	if (!response.ok || !response.body) {
		await response.body?.cancel().catch(() => {});
		return {
			ok: false,
			reason: response.status === 404 || response.status === 403 ? "Discord's link to it has expired" : "couldn't download it from Discord"
		};
	}

	const length = Number(response.headers.get('content-length'));
	const declaredBytes = Number.isFinite(length) && length > 0 ? length : (options.declaredBytes ?? null);
	try {
		return await ingestStream(response.body as unknown as AsyncIterable<Uint8Array>, {
			...options,
			declaredBytes,
			extension: extensionOf(parsed.pathname)
		});
	} catch (error) {
		container.logger.warn(`[playlistMedia] download failed: ${String(error)}`);
		return { ok: false, reason: "couldn't download it from Discord" };
	}
}

export async function ingestAttachment(attachment: Attachment, uploaderId: string, guildId: string): Promise<IngestResult> {
	const check = validateAudioAttachment(attachment);
	if (!check.ok) return { ok: false, reason: check.reason };
	return ingestFromDiscordCdn(check.url, { uploaderId, guildId, declaredBytes: attachment.size });
}

/** The stored file behind a track Lavalink is playing from our own /media route, if it is one. */
export function mediaFileFromUri(uri: string | null | undefined): string | null {
	const prefix = `${mediaBaseUrl()}/media/`;
	if (!uri?.startsWith(prefix)) return null;
	const name = uri.slice(prefix.length);
	if (!isMediaFileName(name)) return null;
	return db.prepare(`SELECT 1 FROM playlist_media WHERE file = ?`).get(name) ? name : null;
}

/** Asks Lavalink to load a stored file, filling in what the http source can't know. */
export async function resolveMediaTrack(kazagumo: Kazagumo, file: string, title: string, requester: User | null): Promise<KazagumoTrack | null> {
	const result = await kazagumo.search(mediaUrl(file), { requester });
	const track = result.tracks[0];
	if (!track) return null;
	if (!track.title || /^unknown title$/i.test(track.title)) track.title = title;
	return track;
}

/**
 * The playlist row for a stored file. The raw track is the one Lavalink built from our /media URL,
 * so it replays straight from disk. `uri` is left empty: the /media address is internal plumbing,
 * not a link worth showing anyone.
 */
export function toMediaNewTrack(track: KazagumoTrack, file: string, title: string): NewTrack {
	const raw = structuredClone(track.getRaw()._raw) as { info: { title: string; author: string } };
	raw.info.title = title;
	// Kazagumo re-searches YouTube for a track with no author (KazagumoTrack#readyToPlay).
	if (!raw.info.author || /^unknown artist$/i.test(raw.info.author)) raw.info.author = 'Uploaded file';
	return {
		title,
		uri: null,
		author: raw.info.author,
		lengthMs: track.length ?? 0,
		source: 'upload',
		rawJson: JSON.stringify(raw),
		mediaFile: file
	};
}

/**
 * Removes stored files no playlist track uses, plus anything stray in the directory: partial
 * downloads from a crash and files with no record. Recent files are skipped (see PRUNE_GRACE_MS).
 */
export async function pruneOrphanMedia(): Promise<number> {
	const cutoff = new Date(Date.now() - PRUNE_GRACE_MS).toISOString();
	const orphans = db.transaction(() => {
		const rows = db
			.prepare(
				`SELECT file FROM playlist_media m
				 WHERE m.created_at < ? AND NOT EXISTS (SELECT 1 FROM playlist_tracks t WHERE t.media_file = m.file)`
			)
			.all(cutoff) as { file: string }[];
		const remove = db.prepare(`DELETE FROM playlist_media WHERE file = ?`);
		for (const { file } of rows) remove.run(file);
		return rows.map(({ file }) => file);
	})();

	for (const file of orphans) await rm(join(PLAYLIST_MEDIA_DIR, file), { force: true });

	const known = db.prepare(`SELECT 1 FROM playlist_media WHERE file = ?`);
	const oldest = Date.now() - PRUNE_GRACE_MS;
	let strays = 0;
	for (const name of await readdir(PLAYLIST_MEDIA_DIR).catch(() => [] as string[])) {
		if (isMediaFileName(name) && known.get(name)) continue;
		if (!isMediaFileName(name) && !/^\.[0-9a-f]{16}\.part$/.test(name)) continue;
		const info = await stat(join(PLAYLIST_MEDIA_DIR, name)).catch(() => null);
		if (info?.isFile() && info.mtimeMs < oldest) {
			await rm(join(PLAYLIST_MEDIA_DIR, name), { force: true });
			strays++;
		}
	}

	if (orphans.length || strays) container.logger.info(`[playlistMedia] pruned ${orphans.length} unused and ${strays} stray files`);
	return orphans.length + strays;
}

/** Fire-and-forget prune after tracks are removed; failures only get logged. */
export function pruneOrphanMediaSoon(): void {
	setImmediate(() => void pruneOrphanMedia().catch((error) => container.logger.warn(`[playlistMedia] prune failed: ${String(error)}`)));
}

let pruneTimer: NodeJS.Timeout | null = null;

/** Called once at startup: prunes now, then hourly, which also catches files whose save failed. */
export function startMediaPruner(): void {
	if (pruneTimer) return;
	pruneOrphanMediaSoon();
	pruneTimer = setInterval(pruneOrphanMediaSoon, PRUNE_INTERVAL_MS);
	pruneTimer.unref();
}
