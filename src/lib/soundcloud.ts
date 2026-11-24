import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import type { Kazagumo, KazagumoSearchResult } from 'kazagumo';

/**
 * SoundCloud playback by downloading the audio here and handing Lavalink a URL on our own API.
 *
 * Lavalink's built-in SoundCloud source resolves metadata fine but 404s on the stream itself
 * (lavalink-devs/Lavalink#1221), so a queued SoundCloud track plays silence. Instead this asks
 * SoundCloud's own API for the stream, remuxes it with ffmpeg into one plain file Lavalink's http
 * source can seek in, and serves that file from /media. The audio always comes from SoundCloud;
 * nothing is looked up on another platform.
 */

export class SoundCloudError extends Error {}

const API = 'https://api-v2.soundcloud.com';
const SHORT_LINK_HOST = 'on.soundcloud.com';
const HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);

/** Long DJ sets exist; past this the download and disk cost stop being reasonable. */
export const MAX_DURATION_MS = 3 * 60 * 60 * 1000;
/** Downloaded files are kept this long, so a track queued a while ago still plays. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export const MEDIA_DIR = join(tmpdir(), 'lyra-media');

/** True for links this module handles: a track page or an on.soundcloud.com share link. */
export function isSoundCloudLink(query: string): boolean {
	let url: URL;
	try {
		url = new URL(query.trim());
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
	return url.hostname === SHORT_LINK_HOST || HOSTS.has(url.hostname);
}

/** Share links are redirects to the real page; only SoundCloud's own hosts are followed. */
async function canonicalUrl(query: string): Promise<string> {
	let url = new URL(query.trim());
	if (url.hostname === SHORT_LINK_HOST) {
		const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
		const location = response.headers.get('location');
		if (!location) throw new SoundCloudError("❌ that SoundCloud share link doesn't go anywhere.");
		url = new URL(location, url);
		if (!HOSTS.has(url.hostname)) throw new SoundCloudError("❌ that share link doesn't point at a SoundCloud page.");
	}
	// Tracking params (`si`, `utm_*`) are noise to /resolve; private tracks carry their secret in the path.
	return `https://soundcloud.com${url.pathname.replace(/\/+$/, '')}`;
}

let clientId: string | null = null;

/**
 * SoundCloud has no public API key; the web app's own client_id sits in one of its JS bundles.
 * This is what yt-dlp and lavaplayer do too.
 */
async function getClientId(refresh = false): Promise<string> {
	if (clientId && !refresh) return clientId;
	const html = await (await fetch('https://soundcloud.com/', { signal: AbortSignal.timeout(10_000) })).text();
	const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
	// The id lives in one of the last bundles.
	for (const src of scripts.reverse()) {
		const js = await (await fetch(src, { signal: AbortSignal.timeout(10_000) })).text();
		const match = /client_id\s*[:=]\s*"(\w{32})"/.exec(js);
		if (match) return (clientId = match[1]!);
	}
	throw new Error('SoundCloud client_id not found in its web bundles');
}

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
	for (const refresh of [false, true]) {
		const url = new URL(path.startsWith('http') ? path : `${API}${path}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		url.searchParams.set('client_id', await getClientId(refresh));
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		// A rotated client_id answers 401/403; fetch a fresh one once.
		if ((response.status === 401 || response.status === 403) && !refresh) continue;
		if (response.status === 404) throw new SoundCloudError("❌ SoundCloud says that track doesn't exist (or it's private).");
		if (!response.ok) throw new Error(`SoundCloud API ${url.pathname} answered ${response.status}`);
		return (await response.json()) as T;
	}
	throw new Error('SoundCloud API rejected a fresh client_id');
}

export interface Transcoding {
	url: string;
	snipped?: boolean;
	format: { protocol: string; mime_type: string };
}

interface ScTrack {
	kind: string;
	id: number;
	title: string;
	duration: number;
	permalink_url: string;
	artwork_url: string | null;
	policy?: string;
	track_authorization?: string;
	user?: { username?: string };
	media?: { transcodings?: Transcoding[] };
}

const FORMATS = [
	{ mime: 'audio/mpeg', ext: 'mp3' },
	{ mime: 'audio/mp4', ext: 'm4a' },
	{ mime: 'audio/ogg', ext: 'ogg' }
] as const;

/**
 * Picks the stream to download. Encrypted HLS (`ctr-encrypted-hls`, `cbc-encrypted-hls`) is DRM
 * and is skipped; previews are skipped so a Go+ track isn't silently cut to 30 seconds.
 */
export function pickTranscoding(transcodings: Transcoding[]): { transcoding: Transcoding; ext: string } | null {
	const usable = transcodings.filter((t) => !t.snipped && (t.format.protocol === 'progressive' || t.format.protocol === 'hls'));
	// Progressive first (one plain file), then by format order above.
	const ranked = usable
		// Exact base type: `audio/mpegurl` (the adaptive `abr_sq` playlist, which 404s) is not `audio/mpeg`.
		.map((t) => ({ t, f: FORMATS.findIndex((f) => t.format.mime_type.split(';')[0]!.trim() === f.mime) }))
		.filter((x) => x.f !== -1)
		.sort((a, b) => Number(b.t.format.protocol === 'progressive') - Number(a.t.format.protocol === 'progressive') || a.f - b.f);
	const best = ranked[0];
	return best ? { transcoding: best.t, ext: FORMATS[best.f]!.ext } : null;
}

/** Copy, not re-encode: ffmpeg only unwraps HLS into one file with a real duration and index. */
function remux(input: string, output: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const ffmpeg = spawn(ffmpegPath, [
			'-hide_banner',
			'-loglevel',
			'error',
			'-protocol_whitelist',
			'https,tls,tcp,crypto,hls,http',
			'-i',
			input,
			'-vn',
			'-c:a',
			'copy',
			...(output.endsWith('.m4a') ? ['-movflags', '+faststart'] : []),
			'-y',
			output
		]);
		let stderr = '';
		ffmpeg.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-500)));
		const timer = setTimeout(() => ffmpeg.kill('SIGKILL'), DOWNLOAD_TIMEOUT_MS);
		ffmpeg.on('error', reject);
		ffmpeg.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
		});
	});
}

/** Track id → file name, so re-queueing the same track reuses the download. */
const downloads = new Map<number, Promise<string>>();

async function sweepCache(): Promise<void> {
	const now = Date.now();
	for (const name of await readdir(MEDIA_DIR).catch(() => [] as string[])) {
		const file = join(MEDIA_DIR, name);
		const info = await stat(file).catch(() => null);
		if (info && now - info.mtimeMs > CACHE_TTL_MS) await rm(file, { force: true });
	}
}

async function download(track: ScTrack): Promise<string> {
	const picked = pickTranscoding(track.media?.transcodings ?? []);
	if (!picked) {
		const snippedOnly = track.media?.transcodings?.some((t) => t.snipped);
		throw new SoundCloudError(
			snippedOnly
				? '❌ SoundCloud only gives out a 30-second preview of that one (Go+ track).'
				: "❌ SoundCloud doesn't offer a stream I can play for that one."
		);
	}
	const params: Record<string, string> = track.track_authorization ? { track_authorization: track.track_authorization } : {};
	const { url: streamUrl } = await api<{ url: string }>(picked.transcoding.url, params);

	await mkdir(MEDIA_DIR, { recursive: true });
	await sweepCache();
	const name = `${randomBytes(16).toString('hex')}.${picked.ext}`;
	try {
		await remux(streamUrl, join(MEDIA_DIR, name));
	} catch (e) {
		await rm(join(MEDIA_DIR, name), { force: true });
		throw e;
	}
	return name;
}

/** Shares one download between concurrent requests, and redoes it if the sweep removed the file. */
async function downloadOnce(track: ScTrack): Promise<string> {
	const cached = downloads.get(track.id);
	if (cached) {
		const name = await cached.catch(() => null);
		if (name && (await stat(join(MEDIA_DIR, name)).catch(() => null))) return name;
		if (downloads.get(track.id) === cached) downloads.delete(track.id);
		else return downloadOnce(track);
	}
	const pending = download(track);
	downloads.set(track.id, pending);
	pending.catch(() => downloads.delete(track.id));
	return pending;
}

function mediaBaseUrl(): string {
	// `||`: compose passes an unset variable through as the empty string.
	return (process.env.LAVALINK_MEDIA_BASE_URL || `http://lyra-bot:${process.env.API_PORT || '4000'}`).replace(/\/+$/, '');
}

/**
 * Resolves a SoundCloud link into a queueable track. Throws SoundCloudError with a user-facing
 * message for anything the user can act on.
 */
export async function resolveSoundCloud(kazagumo: Kazagumo, query: string, requester: unknown): Promise<KazagumoSearchResult> {
	const pageUrl = await canonicalUrl(query);
	const track = await api<ScTrack>('/resolve', { url: pageUrl });
	if (track.kind !== 'track') throw new SoundCloudError('❌ only single SoundCloud tracks work right now, not sets or profiles.');
	if (track.policy === 'BLOCK') throw new SoundCloudError('❌ SoundCloud blocks that track in this region.');
	if (track.duration > MAX_DURATION_MS) throw new SoundCloudError('❌ that track is over 3 hours, too long to download.');

	const file = await downloadOnce(track);

	const result = await kazagumo.search(`${mediaBaseUrl()}/media/${file}`, { requester });
	const queued = result.tracks[0];
	if (!queued) throw new Error(`Lavalink could not load the downloaded SoundCloud file ${file}`);
	// The http source knows nothing but the bytes. Kazagumo also re-searches YouTube for any track
	// missing an author or length (KazagumoTrack#readyToPlay), so these have to be filled in.
	// `uri` is the SoundCloud page, so history and saved playlists replay through here again.
	queued.title = track.title;
	queued.author = track.user?.username || 'SoundCloud';
	queued.uri = track.permalink_url;
	queued.length ||= track.duration;
	queued.thumbnail = track.artwork_url?.replace('-large.', '-t500x500.') ?? queued.thumbnail;
	return { type: 'TRACK', tracks: [queued] };
}
