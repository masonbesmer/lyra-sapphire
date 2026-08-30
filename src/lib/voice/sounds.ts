import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rootDir } from '../constants';

/**
 * On-disk store for the clips a `sound` voice trigger plays back.
 *
 * Files are kept per guild and addressed by a sanitised name rather than by path, so nothing
 * a user types ever reaches the filesystem verbatim.
 */
const soundsRoot = process.env.VOICE_SOUNDS_DIR ?? join(rootDir, 'data', 'voice_sounds');

/** Discord's own attachment ceiling for the common case is far higher; this is about playback. */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;
export const MAX_SOUNDS_PER_GUILD = 50;

/** Containers ffmpeg reads happily and Discord hands out. The extension is kept for ffmpeg's probe. */
const ALLOWED_EXTENSIONS = new Set(['mp3', 'ogg', 'oga', 'opus', 'wav', 'webm', 'm4a', 'mp4', 'flac', 'aac']);

/**
 * Reduces a user-supplied name to the characters the store allows.
 *
 * Returns null rather than a fallback when nothing survives: a silent rename would let two
 * different names collapse onto one file and overwrite each other.
 */
export function sanitiseSoundName(name: string): string | null {
	const cleaned = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return cleaned || null;
}

export function extensionOf(filename: string): string | null {
	const match = /\.([a-z0-9]{1,5})$/i.exec(filename);
	const ext = match?.[1].toLowerCase();
	return ext && ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

function guildDir(guildId: string): string {
	// guildId is a snowflake from Discord, never user input, but the assertion is cheap.
	if (!/^\d+$/.test(guildId)) throw new Error(`refusing to build a sounds path for ${guildId}`);
	return join(soundsRoot, guildId);
}

/** Sound names, without extensions — what a trigger's `response` column holds. */
export function listSounds(guildId: string): string[] {
	const dir = guildDir(guildId);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((file) => file.replace(/\.[^.]+$/, ''))
		.sort();
}

/**
 * Absolute path of a stored sound, or null if it is not there.
 *
 * The resolved path is checked against the guild's directory before it is returned. Names are
 * sanitised on the way in, so this is belt and braces — but it is the one function whose
 * output is handed to ffmpeg, and that is the wrong place to be relying on an invariant held
 * somewhere else.
 */
export function soundPath(guildId: string, name: string): string | null {
	const safe = sanitiseSoundName(name);
	if (!safe) return null;

	const dir = guildDir(guildId);
	if (!existsSync(dir)) return null;

	for (const file of readdirSync(dir)) {
		if (file.replace(/\.[^.]+$/, '') !== safe) continue;
		const full = resolve(dir, file);
		if (!full.startsWith(resolve(dir) + '/')) return null;
		return full;
	}
	return null;
}

export type SaveResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Downloads an attachment into the guild's sound store.
 *
 * The size is checked against the declared length *and* against what actually arrives, since
 * the two only agree when the sender is honest.
 */
export async function saveSound(guildId: string, name: string, url: string, declaredBytes: number): Promise<SaveResult> {
	const safe = sanitiseSoundName(name);
	if (!safe) return { ok: false, error: 'that name has nothing usable in it — letters and numbers, please.' };

	const ext = extensionOf(new URL(url).pathname);
	if (!ext) return { ok: false, error: `I can't play that file type. Try ${[...ALLOWED_EXTENSIONS].sort().join(', ')}.` };

	if (declaredBytes > MAX_SOUND_BYTES) {
		return { ok: false, error: `that clip is ${(declaredBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_SOUND_BYTES / 1024 / 1024} MB.` };
	}

	const dir = guildDir(guildId);
	mkdirSync(dir, { recursive: true });
	if (!soundPath(guildId, safe) && listSounds(guildId).length >= MAX_SOUNDS_PER_GUILD) {
		return { ok: false, error: `this server is already at ${MAX_SOUNDS_PER_GUILD} sounds. Delete one first.` };
	}

	let bytes: Buffer;
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		if (!response.ok) return { ok: false, error: `couldn't download that: ${response.status}.` };
		bytes = Buffer.from(await response.arrayBuffer());
	} catch (error) {
		return { ok: false, error: `couldn't download that: ${String(error)}` };
	}

	if (bytes.byteLength === 0) return { ok: false, error: 'that file is empty.' };
	if (bytes.byteLength > MAX_SOUND_BYTES) return { ok: false, error: `that clip is over the ${MAX_SOUND_BYTES / 1024 / 1024} MB limit.` };

	// Replacing a sound must not leave the old container behind under a different extension,
	// or `soundPath` would go on finding whichever readdir happened to return first.
	deleteSound(guildId, safe);
	writeFileSync(join(dir, `${safe}.${ext}`), bytes);
	return { ok: true, name: safe };
}

export function deleteSound(guildId: string, name: string): boolean {
	const path = soundPath(guildId, name);
	if (!path) return false;
	rmSync(path, { force: true });
	return true;
}

export function soundSizeBytes(guildId: string, name: string): number | null {
	const path = soundPath(guildId, name);
	if (!path) return null;
	return statSync(path).size;
}
