import { escapeMarkdown, type Attachment, type ChatInputCommandInteraction, type Message, type User } from 'discord.js';
import type { Kazagumo, KazagumoTrack } from 'kazagumo';
import { getMusicConfig } from './config';
import { getOrCreatePlayer, initPlayerMeta } from './musicCommandHelpers';

/** Hard cap per file. Discord's own upload ceiling is lower for most users; this is the backstop. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** Ceiling on files accepted in one invocation, for both the slash options and a message's attachments. */
export const MAX_FILES_PER_COMMAND = 10;

/**
 * Attachment URLs are only ever read back off a Discord message object, so in practice the host
 * is always one of these. Pinning it anyway keeps a future caller (a dashboard field, a voice
 * intent) from turning this into an open URL fetcher: Lavalink resolves whatever it is handed
 * from inside the Docker network, so an arbitrary URL here is an SSRF primitive.
 */
const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/**
 * Allowlist, not a denylist, and deliberately audio-container-only. The entries that matter most
 * are the ones absent: `.m3u`, `.m3u8`, `.pls`, `.xspf` and `.asx` are playlists, and lavaplayer
 * follows the URLs inside them — a two-line text file would otherwise make Lavalink fetch
 * `http://localhost:2333` or any other host on its network on request.
 */
const ALLOWED_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'webm', 'mka']);

/**
 * Checked against Discord's own sniffed content type when it provides one, so a video re-labelled
 * `.mp3` is turned away before it reaches the node. `application/octet-stream` is allowed through
 * because Discord reports it for anything the uploader's browser could not identify (routinely
 * FLAC and Opus); those still have to clear the extension check above, and Lavalink probes the
 * container itself before it will play a byte.
 */
const ALLOWED_MIME_TYPES = new Set([
	'application/octet-stream',
	'audio/aac',
	'audio/aacp',
	'audio/flac',
	'audio/mp3',
	'audio/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/opus',
	'audio/vnd.wave',
	'audio/wav',
	'audio/wave',
	'audio/webm',
	'audio/x-flac',
	'audio/x-m4a',
	'audio/x-matroska',
	'audio/x-wav'
]);

export type AttachmentCheck = { ok: true; url: string; title: string } | { ok: false; title: string; reason: string };

/**
 * Filenames are attacker-controlled text, so strip the Unicode control/format categories
 * (zero-width joiners, RTL overrides) and clamp the length. The result is plain text and still
 * needs `escapeMarkdown` at the point it is interpolated into a message — it is stored on the
 * track unescaped so it reads the same way a YouTube title does everywhere else in the queue.
 */
export function safeDisplayName(name: string): string {
	const stripped = name.replace(/\p{C}/gu, '').trim();
	const withoutExtension = stripped.replace(/\.[^.]+$/, '');
	return (withoutExtension || 'audio').slice(0, 100);
}

export function validateAudioAttachment(attachment: Attachment): AttachmentCheck {
	const title = safeDisplayName(attachment.name);

	if (attachment.size > MAX_ATTACHMENT_BYTES) {
		return { ok: false, title, reason: `too big (${formatBytes(attachment.size)}, limit ${formatBytes(MAX_ATTACHMENT_BYTES)})` };
	}

	let url: URL;
	try {
		url = new URL(attachment.url);
	} catch {
		return { ok: false, title, reason: 'unreadable attachment URL' };
	}
	if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
		return { ok: false, title, reason: 'not hosted on Discord' };
	}

	// The pathname, not `attachment.name`: this is the string Lavalink actually fetches, and the
	// two can disagree.
	const filename = url.pathname.split('/').pop() ?? '';
	const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
	if (!extension) return { ok: false, title, reason: 'no file extension, so I have no idea what it is' };
	if (!ALLOWED_EXTENSIONS.has(extension)) {
		return { ok: false, title, reason: `\`.${escapeMarkdown(extension.slice(0, 12))}\` isn't an audio format I take` };
	}

	const mime = attachment.contentType?.split(';')[0]?.trim().toLowerCase();
	if (mime && !ALLOWED_MIME_TYPES.has(mime)) {
		return { ok: false, title, reason: `that's \`${escapeMarkdown(mime.slice(0, 40))}\`, not audio` };
	}

	// Signed CDN URL: the `ex`/`is`/`hm` query params are the signature and must survive intact,
	// so hand Lavalink `attachment.url` whole rather than a rebuilt origin+pathname.
	return { ok: true, url: attachment.url, title };
}

function formatBytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Enough for every signature below; the MP4 `ftyp` box is the deepest at offset 4. */
const SNIFF_BYTES = 64;

/**
 * Reads the first few bytes off the CDN and matches them against known audio container
 * signatures.
 *
 * The name checks above are policy, not enforcement: lavaplayer picks a container by probing
 * content, not by extension, so a two-line M3U renamed `.mp3` would still be read as a playlist
 * and Lavalink would then fetch the URLs inside it from within the Docker network. This is the
 * check that actually makes "audio files only" true. It fails closed — if the bytes can't be
 * read, the file doesn't play.
 */
async function looksLikeAudio(url: string): Promise<boolean> {
	let head: Buffer;
	try {
		const response = await fetch(url, {
			headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
			signal: AbortSignal.timeout(5000)
		});
		if (!response.ok || !response.body) return false;

		// Range is a request, not a guarantee — read only what's needed and drop the connection,
		// so a CDN that answers 200 with the whole file doesn't pull it into memory.
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let read = 0;
		try {
			while (read < SNIFF_BYTES) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				read += value.length;
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		head = Buffer.concat(chunks);
	} catch {
		return false;
	}

	if (head.length < 12) return false;
	const ascii = (start: number, end: number) => head.subarray(start, end).toString('latin1');

	// MPEG audio frame sync, which also covers ADTS AAC (0xFFF1 / 0xFFF9).
	if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return true;
	if (ascii(0, 3) === 'ID3') return true; // tagged MP3
	if (ascii(0, 4) === 'fLaC') return true;
	if (ascii(0, 4) === 'OggS') return true; // Ogg: Vorbis, Opus, FLAC
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return true;
	if (ascii(4, 8) === 'ftyp') return true; // ISO-BMFF: M4A / M4B
	if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true; // EBML: WebM / Matroska
	return false;
}

async function resolveAttachmentTrack(kazagumo: Kazagumo, check: { url: string; title: string }, requester: User): Promise<KazagumoTrack | null> {
	// A URL is passed straight through to the node's /v4/loadtracks, so no search engine applies
	// and the http source does the work.
	const result = await kazagumo.search(check.url, { requester });
	const track = result.tracks[0];
	if (!track) return null;
	// The http source titles a track from its container metadata and falls back to a placeholder;
	// an uploaded file usually has no tags, and "Unknown title" in the queue is useless.
	if (!track.title || /^unknown title$/i.test(track.title)) track.title = check.title;
	return track;
}

export interface PlayFileContext {
	guildId: string;
	voiceChannelId: string;
	textChannelId: string;
	requester: User;
	interaction: ChatInputCommandInteraction | Message;
}

/**
 * Validates, resolves and queues a batch of attachments, returning the reply text. Rejections are
 * reported per file rather than failing the whole batch, so one bad upload doesn't discard the
 * good ones.
 */
export async function playAttachments(kazagumo: Kazagumo, attachments: Attachment[], ctx: PlayFileContext): Promise<string> {
	const tracks: KazagumoTrack[] = [];
	const skipped: string[] = [];

	for (const attachment of attachments.slice(0, MAX_FILES_PER_COMMAND)) {
		const check = validateAudioAttachment(attachment);
		if (!check.ok) {
			skipped.push(`**${escapeMarkdown(check.title)}** — ${check.reason}`);
			continue;
		}
		if (!(await looksLikeAudio(check.url))) {
			skipped.push(`**${escapeMarkdown(check.title)}** — the contents aren't audio, whatever it's named`);
			continue;
		}
		const track = await resolveAttachmentTrack(kazagumo, check, ctx.requester);
		if (!track) {
			skipped.push(`**${escapeMarkdown(check.title)}** — couldn't decode that file`);
			continue;
		}
		tracks.push(track);
	}

	if (attachments.length > MAX_FILES_PER_COMMAND) {
		skipped.push(`_${attachments.length - MAX_FILES_PER_COMMAND} more ignored — ${MAX_FILES_PER_COMMAND} files max per command._`);
	}

	if (!tracks.length) return `❌ nothing playable here.\n${skipped.join('\n')}`.slice(0, 2000);

	const cfg = getMusicConfig(ctx.guildId);
	const player = await getOrCreatePlayer(kazagumo, {
		guildId: ctx.guildId,
		voiceId: ctx.voiceChannelId,
		textId: ctx.textChannelId,
		volume: cfg.default_volume
	});
	initPlayerMeta(player, { interaction: ctx.interaction, channelId: ctx.textChannelId, requestedBy: ctx.requester });

	// Count first: KazagumoQueue#add shifts the first entry off the array it is handed when
	// nothing is playing.
	const queuedCount = tracks.length;
	// The single-file title may have come from the container's own tags rather than the filename,
	// which is just as attacker-controlled — escape either way.
	const label = queuedCount === 1 ? `**${escapeMarkdown(tracks[0]!.title)}**` : `${queuedCount} files`;
	player.queue.add(tracks);
	if (!player.playing && !player.paused) await player.play();

	const lines = [`✅ queued ${label}`];
	if (skipped.length) lines.push(`\n⚠️ skipped:\n${skipped.join('\n')}`);
	return lines.join('\n').slice(0, 2000);
}
