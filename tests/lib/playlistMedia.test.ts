import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { container } from '@sapphire/framework';
import { KazagumoTrack } from 'kazagumo';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/lib/database';
import {
	ingestFromDiscordCdn,
	ingestStream,
	isMediaFileName,
	MAX_MEDIA_BYTES_PER_GUILD,
	MAX_MEDIA_BYTES_PER_USER,
	mediaUrl,
	PLAYLIST_MEDIA_DIR,
	pruneOrphanMedia
} from '../../src/lib/playlistMedia';
import { toSavableTrack } from '../../src/lib/playlistPlayback';
import { addTracks, createPlaylist, listTracks, removeTrack } from '../../src/lib/playlists';
import { UserRoute as MediaRoute } from '../../src/routes/media/[file].get';

beforeEach(() => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

let seq = 0;
/** A distinct, valid-looking MP3 each call: an ID3 header plus unique padding. */
function mp3(size = 64): Buffer {
	const bytes = Buffer.alloc(size);
	bytes.write('ID3', 0, 'latin1');
	bytes.writeUInt32BE(++seq, 8);
	return bytes;
}

async function* chunks(bytes: Buffer, size = 16) {
	for (let i = 0; i < bytes.length; i += size) yield new Uint8Array(bytes.subarray(i, i + size));
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const rows = () => (db.prepare(`SELECT file FROM playlist_media`).all() as { file: string }[]).map((r) => r.file);
const partFiles = () => readdirSync(PLAYLIST_MEDIA_DIR).filter((name) => name.endsWith('.part'));

function ingest(bytes: Buffer, uploaderId = 'uploader', guildId = 'guild', extension = 'mp3') {
	return ingestStream(chunks(bytes), { extension, uploaderId, guildId });
}

function age(file: string, minutes: number) {
	db.prepare(`UPDATE playlist_media SET created_at = ? WHERE file = ?`).run(new Date(Date.now() - minutes * 60_000).toISOString(), file);
}

describe('ingestStream', () => {
	it('stores the file under its hash and records who paid for it', async () => {
		const bytes = mp3();
		const result = await ingest(bytes, 'alice', 'g1');
		expect(result).toEqual({ ok: true, file: `${sha(bytes)}.mp3`, bytes: bytes.length });
		expect(existsSync(join(PLAYLIST_MEDIA_DIR, `${sha(bytes)}.mp3`))).toBe(true);
		expect(db.prepare(`SELECT uploaded_by, guild_id, size_bytes FROM playlist_media WHERE file = ?`).get(`${sha(bytes)}.mp3`)).toEqual({
			uploaded_by: 'alice',
			guild_id: 'g1',
			size_bytes: 64
		});
		expect(partFiles()).toEqual([]);
	});

	it('stores a repeated upload once, charged to the first uploader', async () => {
		const bytes = mp3();
		await ingest(bytes, 'first');
		const again = await ingest(bytes, 'second');
		expect(again).toMatchObject({ ok: true, file: `${sha(bytes)}.mp3` });
		expect(rows().filter((file) => file.startsWith(sha(bytes)))).toHaveLength(1);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM playlist_media WHERE uploaded_by = 'second'`).get()).toEqual({ n: 0 });
	});

	it("refuses bytes that aren't audio whatever the name, and leaves nothing behind", async () => {
		const before = rows().length;
		const result = await ingest(Buffer.from('#EXTM3U\nhttp://localhost:2333/\n'.padEnd(64, ' ')));
		expect(result).toMatchObject({ ok: false });
		expect(rows()).toHaveLength(before);
		expect(partFiles()).toEqual([]);
	});

	it('refuses an extension outside the audio allowlist before reading anything', async () => {
		const read = vi.fn();
		const source = { [Symbol.asyncIterator]: () => ({ next: read }) };
		expect(await ingestStream(source as never, { extension: 'm3u', uploaderId: 'u', guildId: 'g' })).toMatchObject({ ok: false });
		expect(read).not.toHaveBeenCalled();
	});

	it('refuses a declared size over the cap without reading anything', async () => {
		const read = vi.fn();
		const source = { [Symbol.asyncIterator]: () => ({ next: read }) };
		const result = await ingestStream(source as never, { extension: 'mp3', uploaderId: 'u', guildId: 'g', declaredBytes: 500 * 1024 * 1024 });
		expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('too big') });
		expect(read).not.toHaveBeenCalled();
	});

	it("enforces the uploader's quota, but a copy of a stored file is free", async () => {
		const existing = mp3();
		await ingest(existing, 'heavy', 'quota-user-guild');
		db.prepare(`INSERT INTO playlist_media (file, size_bytes, uploaded_by, guild_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(
			`${'a'.repeat(64)}.mp3`,
			MAX_MEDIA_BYTES_PER_USER - 64,
			'heavy',
			'quota-user-guild',
			new Date().toISOString()
		);

		expect(await ingest(mp3(), 'heavy', 'quota-user-guild')).toMatchObject({ ok: false, reason: expect.stringContaining('your') });
		expect(await ingest(existing, 'heavy', 'quota-user-guild')).toMatchObject({ ok: true });
		expect(partFiles()).toEqual([]);
	});

	it("enforces the guild's quota across uploaders", async () => {
		db.prepare(`INSERT INTO playlist_media (file, size_bytes, uploaded_by, guild_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(
			`${'b'.repeat(64)}.mp3`,
			MAX_MEDIA_BYTES_PER_GUILD,
			'someone-else',
			'full-guild',
			new Date().toISOString()
		);
		expect(await ingest(mp3(), 'newcomer', 'full-guild')).toMatchObject({ ok: false, reason: expect.stringContaining('server') });
	});
});

describe('ingestFromDiscordCdn', () => {
	it('fetches nothing that is not on Discord’s CDN', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		expect(await ingestFromDiscordCdn('https://example.com/a.mp3', { uploaderId: 'u', guildId: 'g' })).toMatchObject({ ok: false });
		expect(await ingestFromDiscordCdn('http://cdn.discordapp.com/a.mp3', { uploaderId: 'u', guildId: 'g' })).toMatchObject({ ok: false });
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});

describe('isMediaFileName', () => {
	it('accepts only a SHA-256 name with an audio extension', () => {
		expect(isMediaFileName(`${'0'.repeat(64)}.flac`)).toBe(true);
		expect(isMediaFileName(`${'0'.repeat(64)}.m3u`)).toBe(false);
		expect(isMediaFileName(`${'0'.repeat(32)}.mp3`)).toBe(false);
		expect(isMediaFileName(`../${'0'.repeat(64)}.mp3`)).toBe(false);
	});
});

function savedTrack(file: string) {
	return {
		title: 'upload',
		uri: null,
		author: 'Uploaded file',
		lengthMs: 1000,
		source: 'upload',
		rawJson: JSON.stringify(rawTrack(mediaUrl(file))),
		mediaFile: file
	};
}

function rawTrack(uri: string, author = 'Unknown artist') {
	return {
		encoded: 'encoded',
		info: {
			identifier: uri,
			isSeekable: true,
			author,
			length: 1000,
			isStream: false,
			position: 0,
			title: 'Unknown title',
			uri,
			sourceName: 'http'
		},
		pluginInfo: {}
	};
}

describe('pruneOrphanMedia', () => {
	it('removes old files no track uses, and keeps used or recent ones', async () => {
		const used = (await ingest(mp3())) as { file: string };
		const orphan = (await ingest(mp3())) as { file: string };
		const fresh = (await ingest(mp3())) as { file: string };
		const list = createPlaylist('pruner', { name: 'keep' });
		if (!list.ok) throw new Error(list.error);
		addTracks(list.playlist.id, [savedTrack(used.file)], 'pruner');
		age(used.file, 60);
		age(orphan.file, 60);

		await pruneOrphanMedia();
		expect(rows()).toEqual(expect.arrayContaining([used.file, fresh.file]));
		expect(rows()).not.toContain(orphan.file);
		expect(existsSync(join(PLAYLIST_MEDIA_DIR, orphan.file))).toBe(false);
		expect(existsSync(join(PLAYLIST_MEDIA_DIR, used.file))).toBe(true);
	});

	it('runs after the last track using a file is removed', async () => {
		const stored = (await ingest(mp3())) as { file: string };
		const list = createPlaylist('remover', { name: 'gone' });
		if (!list.ok) throw new Error(list.error);
		addTracks(list.playlist.id, [savedTrack(stored.file)], 'remover');
		age(stored.file, 60);

		removeTrack(list.playlist.id, listTracks(list.playlist.id)[0]!.id);
		await vi.waitFor(() => expect(existsSync(join(PLAYLIST_MEDIA_DIR, stored.file))).toBe(false));
		expect(rows()).not.toContain(stored.file);
	});

	it('clears stray files with no record once they are old', async () => {
		mkdirSync(PLAYLIST_MEDIA_DIR, { recursive: true });
		const stray = `${'c'.repeat(64)}.mp3`;
		writeFileSync(join(PLAYLIST_MEDIA_DIR, stray), 'x');
		const past = new Date(Date.now() - 60 * 60_000);
		const { utimesSync } = await import('node:fs');
		utimesSync(join(PLAYLIST_MEDIA_DIR, stray), past, past);

		await pruneOrphanMedia();
		expect(existsSync(join(PLAYLIST_MEDIA_DIR, stray))).toBe(false);
	});
});

describe('toSavableTrack', () => {
	it('points a track playing from a stored file back at that file', async () => {
		const stored = (await ingest(mp3())) as { file: string };
		const playing = new KazagumoTrack(rawTrack(mediaUrl(stored.file)) as never, null);
		playing.title = 'my song';

		const saved = await toSavableTrack(playing, 'user', 'guild');
		expect(saved).toMatchObject({ ok: true, track: { mediaFile: stored.file, uri: null, title: 'my song', author: 'Uploaded file' } });
	});

	it('stores anything else exactly as Lavalink sent it', async () => {
		const playing = new KazagumoTrack(rawTrack('https://www.youtube.com/watch?v=x', 'artist') as never, null);
		const saved = await toSavableTrack(playing, 'user', 'guild');
		expect(saved).toMatchObject({ ok: true, track: { uri: 'https://www.youtube.com/watch?v=x' } });
		expect((saved as { track: { mediaFile?: string } }).track.mediaFile).toBeUndefined();
	});
});

describe('GET /media/:file', () => {
	async function head(file: string) {
		const response = { statusCode: 0, error: vi.fn(), setHeader: vi.fn(), end: vi.fn() };
		await (Object.create(MediaRoute.prototype) as MediaRoute).run({ params: { file }, headers: {}, method: 'HEAD' } as never, response as never);
		return response;
	}

	it('serves a stored playlist file with its audio type', async () => {
		const stored = (await ingest(mp3(), 'u', 'g', 'flac')) as { file: string };
		const response = await head(stored.file);
		expect(response.error).not.toHaveBeenCalled();
		expect(response.statusCode).toBe(200);
		expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/flac');
	});

	it('serves nothing else', async () => {
		expect((await head(`${'d'.repeat(64)}.mp3`)).error).toHaveBeenCalled();
		expect((await head('word_triggers.db')).error).toHaveBeenCalled();
	});
});
