import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES, safeDisplayName, validateAudioAttachment } from '../../src/lib/attachmentAudio';

const CDN = 'https://cdn.discordapp.com/attachments/1/2';

function attachment(overrides: { name?: string; url?: string; size?: number; contentType?: string | null } = {}) {
	return { name: 'song.mp3', url: `${CDN}/song.mp3`, size: 1024, contentType: 'audio/mpeg', ...overrides } as never;
}

describe('safeDisplayName', () => {
	it('strips control and format characters and the extension', () => {
		expect(safeDisplayName('evil‮name‍.mp3')).toBe('evilname');
	});

	it('falls back to "audio" when nothing is left', () => {
		expect(safeDisplayName('.mp3')).toBe('audio');
		expect(safeDisplayName('​')).toBe('audio');
	});

	it('clamps to 100 characters', () => {
		expect(safeDisplayName(`${'n'.repeat(150)}.flac`)).toHaveLength(100);
	});
});

describe('validateAudioAttachment', () => {
	it.each([
		['oversize', { size: MAX_ATTACHMENT_BYTES + 1 }, /^too big/],
		['an unparseable URL', { url: 'not a url' }, /unreadable attachment URL/],
		['plain http', { url: 'http://cdn.discordapp.com/a/song.mp3' }, /not hosted on Discord/],
		['a non-Discord host', { url: 'https://example.com/song.mp3' }, /not hosted on Discord/],
		['no extension', { url: `${CDN}/song` }, /no file extension/],
		['a playlist extension', { url: `${CDN}/list.m3u8` }, /`\.m3u8` isn't an audio format/],
		['a non-audio MIME type', { contentType: 'video/mp4' }, /`video\/mp4`, not audio/]
	])('rejects %s', (_label, overrides, reason) => {
		const result = validateAudioAttachment(attachment(overrides));
		expect(result.ok).toBe(false);
		expect(result.ok ? '' : result.reason).toMatch(reason);
	});

	it('accepts application/octet-stream with an allowed extension', () => {
		expect(validateAudioAttachment(attachment({ url: `${CDN}/a.flac`, contentType: 'application/octet-stream' })).ok).toBe(true);
	});

	it('accepts a missing content type and ignores MIME parameters', () => {
		expect(validateAudioAttachment(attachment({ contentType: null })).ok).toBe(true);
		expect(validateAudioAttachment(attachment({ contentType: 'audio/ogg; codecs=opus' })).ok).toBe(true);
	});

	it('returns the signed URL unchanged and the cleaned title', () => {
		const url = `https://media.discordapp.net/attachments/1/2/Song.MP3?ex=abc&is=def&hm=123`;
		expect(validateAudioAttachment(attachment({ name: 'My Song.mp3', url }))).toEqual({ ok: true, url, title: 'My Song' });
	});

	it('checks the URL pathname extension, not the attachment name', () => {
		expect(validateAudioAttachment(attachment({ name: 'song.mp3', url: `${CDN}/song.m3u` })).ok).toBe(false);
		expect(validateAudioAttachment(attachment({ name: 'playlist.m3u', url: `${CDN}/song.mp3` })).ok).toBe(true);
	});
});
