import { EmbedBuilder } from 'discord.js';
import { cleanTrackTitle } from './music';

/**
 * Lyrics lookup.
 *
 * LRCLIB (https://lrclib.net) is the primary source: free, keyless, JSON, and it matches on
 * artist + title + duration. Genius is kept as a fallback only: its search endpoint answers
 * server IPs with a Cloudflare HTML challenge, which is why lookups used to fail almost always.
 */

const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'lyra-sapphire (https://github.com/masonbesmer/lyra-sapphire)';
const TIMEOUT_MS = 8_000;
/** LRCLIB durations are seconds; treat candidates within this window as the same recording. */
const DURATION_TOLERANCE_S = 5;

export interface LyricsTrack {
	title: string;
	author?: string | null;
	/** Track length in milliseconds (Kazagumo's `track.length`). */
	length?: number | null;
}

export interface LyricsQuery {
	/** Song title with video junk and featured-artist credits removed. */
	title: string;
	/** Best guess at the artist, or null when it can't be inferred. */
	artist: string | null;
	durationSec: number | null;
}

export interface LyricsResult {
	lyrics: string;
	/** Display title ("Artist - Song") of the matched entry. */
	title: string;
	source: 'lrclib' | 'genius';
}

export interface LrclibEntry {
	trackName: string;
	artistName: string;
	duration: number | null;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
}

/** Remove featured-artist credits, which rarely appear in lyrics databases' track names. */
function stripFeatures(text: string): string {
	return text
		.replace(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, '')
		.replace(/\s(?:feat\.?|ft\.?|featuring)\s.*$/i, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** Turn a YouTube/SoundCloud uploader name into something that looks like an artist. */
export function cleanArtistName(author: string): string {
	return author
		.replace(/\s*-\s*topic$/i, '')
		.replace(/vevo$/i, '')
		.replace(/\s*official(?:\s*(?:channel|music|artist))?$/i, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/** Strip notes cleanTrackTitle leaves behind: remaster/version notes in parentheses, surrounding quotes. */
function stripTitleNotes(title: string): string {
	return title
		.replace(/\([^)]*\b(?:remaster(?:ed)?|version|visuali[sz]er|live|edit|mono|stereo|explicit|clean)\b[^)]*\)/gi, '')
		.replace(/^["'“”]+|["'“”]+$/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Work out a structured query from a playing track. YouTube titles are usually "Artist - Song",
 * so that split wins over the uploader name; otherwise the uploader (minus "- Topic"/"VEVO") is the artist.
 */
export function buildLyricsQuery(track: LyricsTrack): LyricsQuery {
	const cleaned = stripTitleNotes(stripFeatures(cleanTrackTitle(track.title)));
	const durationSec = track.length && track.length > 0 ? Math.round(track.length / 1000) : null;

	const dash = cleaned.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
	if (dash) {
		return { artist: stripFeatures(dash[1]), title: stripTitleNotes(dash[2]), durationSec };
	}

	const artist = track.author ? cleanArtistName(stripFeatures(track.author)) : '';
	return { artist: artist || null, title: cleaned, durationSec };
}

/** "Artist - Song" for display and free-text search. */
export function describeQuery(query: LyricsQuery): string {
	return query.artist ? `${query.artist} - ${query.title}` : query.title;
}

/** Remove LRC timestamps (`[01:23.45]`) so synced-only entries still have readable text. */
export function stripLrcTimestamps(synced: string): string {
	return synced
		.split('\n')
		.map((line) => line.replace(/^(?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])+\s?/, ''))
		.join('\n')
		.trim();
}

function entryLyrics(entry: LrclibEntry): string | null {
	if (entry.instrumental) return null;
	const plain = entry.plainLyrics?.trim();
	if (plain) return plain;
	const synced = entry.syncedLyrics ? stripLrcTimestamps(entry.syncedLyrics) : '';
	return synced || null;
}

function normalize(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Score a search hit: prefer matching title, artist and duration. Returns -1 for entries without lyrics. */
export function scoreEntry(entry: LrclibEntry, query: LyricsQuery): number {
	if (!entryLyrics(entry)) return -1;
	let score = 0;

	const wantTitle = normalize(query.title);
	const gotTitle = normalize(entry.trackName);
	if (gotTitle === wantTitle) score += 4;
	else if (gotTitle && wantTitle && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle))) score += 2;

	if (query.artist) {
		const wantArtist = normalize(query.artist);
		const gotArtist = normalize(entry.artistName);
		if (gotArtist === wantArtist) score += 3;
		else if (gotArtist && wantArtist && (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist))) score += 2;
	} else {
		// Free text like "radiohead creep": reward entries whose artist the user typed. Skip junk entries
		// that just repeat the track name as the artist.
		const gotArtist = normalize(entry.artistName);
		if (gotArtist && gotArtist !== gotTitle && ` ${wantTitle} `.includes(` ${gotArtist} `)) score += 3;
	}

	if (query.durationSec && entry.duration) {
		const diff = Math.abs(entry.duration - query.durationSec);
		if (diff <= DURATION_TOLERANCE_S) score += 3;
		else if (diff > 30) score -= 2;
	}

	if (entry.plainLyrics?.trim()) score += 1;
	return score;
}

async function lrclibRequest<T>(path: string, params: Record<string, string | number>): Promise<T | null> {
	const url = new URL(`${LRCLIB_BASE}/${path}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	try {
		const response = await fetch(url.href, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

function toResult(entry: LrclibEntry): LyricsResult | null {
	const lyrics = entryLyrics(entry);
	if (!lyrics) return null;
	return { lyrics, title: `${entry.artistName} - ${entry.trackName}`, source: 'lrclib' };
}

/** Pick the highest-scoring hit. Requires at least a partial title or artist match so we never show random lyrics. */
export function pickBestEntry(entries: LrclibEntry[] | null, query: LyricsQuery): LrclibEntry | null {
	if (!Array.isArray(entries)) return null;
	let best: LrclibEntry | null = null;
	let bestScore = 2;
	for (const entry of entries) {
		const score = scoreEntry(entry, query);
		if (score > bestScore) {
			best = entry;
			bestScore = score;
		}
	}
	return best;
}

export async function fetchFromLrclib(query: LyricsQuery): Promise<LyricsResult | null> {
	// 1. Exact signature lookup: the most precise when we know artist + duration.
	if (query.artist && query.durationSec) {
		const exact = await lrclibRequest<LrclibEntry>('get', { track_name: query.title, artist_name: query.artist, duration: query.durationSec });
		const result = exact ? toResult(exact) : null;
		if (result) return result;
	}

	// 2. Field search, then 3. free-text search (catches titles where the artist/title split was wrong).
	if (query.artist) {
		const hit = pickBestEntry(await lrclibRequest<LrclibEntry[]>('search', { track_name: query.title, artist_name: query.artist }), query);
		if (hit) return toResult(hit);
	}
	const hit = pickBestEntry(await lrclibRequest<LrclibEntry[]>('search', { q: describeQuery(query) }), query);
	return hit ? toResult(hit) : null;
}

async function fetchFromGenius(query: LyricsQuery): Promise<LyricsResult | null> {
	try {
		const { Client } = await import('genius-lyrics');
		const client = new Client();
		const searches = await client.songs.search(describeQuery(query));
		if (!searches.length) return null;
		const lyrics = (await searches[0].lyrics())?.trim();
		return lyrics ? { lyrics, title: searches[0].fullTitle || searches[0].title, source: 'genius' } : null;
	} catch {
		return null;
	}
}

/** Look up lyrics for a playing track, or for user-typed text ("artist - song" or just "song"). */
export async function fetchLyrics(input: LyricsTrack | string): Promise<LyricsResult | null> {
	const query = buildLyricsQuery(typeof input === 'string' ? { title: input } : input);
	if (!query.title) return null;
	return (await fetchFromLrclib(query)) ?? (await fetchFromGenius(query));
}

export function buildLyricsEmbeds(title: string, lyrics: string): EmbedBuilder[] {
	const maxLen = 4096;
	const chunks: string[] = [];
	let remaining = lyrics;
	while (remaining.length > 0) {
		chunks.push(remaining.slice(0, maxLen));
		remaining = remaining.slice(maxLen);
	}
	return chunks.map((chunk) => new EmbedBuilder().setTitle(`📜 ${title}`.slice(0, 256)).setDescription(chunk).setColor(0xffdd57));
}
