import { describe, expect, it } from 'vitest';
import { isSoundCloudLink, pickTranscoding, type Transcoding } from '../../src/lib/soundcloud';

describe('isSoundCloudLink', () => {
	it.each(['https://soundcloud.com/artist/track', 'https://m.soundcloud.com/artist/track?si=abc', 'https://on.soundcloud.com/AbC123'])(
		'accepts %s',
		(url) => expect(isSoundCloudLink(url)).toBe(true)
	);

	it.each(['never gonna give you up', 'https://soundcloud.com.evil.example/x', 'https://youtube.com/watch?v=x', 'ftp://soundcloud.com/a/b'])(
		'rejects %s',
		(q) => expect(isSoundCloudLink(q)).toBe(false)
	);
});

const t = (protocol: string, mime_type: string, snipped = false): Transcoding => ({
	url: `${protocol}:${mime_type}`,
	snipped,
	format: { protocol, mime_type }
});

describe('pickTranscoding', () => {
	it('prefers a progressive stream', () => {
		const picked = pickTranscoding([t('hls', 'audio/mp4; codecs="mp4a.40.2"'), t('progressive', 'audio/mpeg')]);
		expect(picked).toEqual({ transcoding: expect.objectContaining({ url: 'progressive:audio/mpeg' }), ext: 'mp3' });
	});

	it('falls back to HLS AAC as m4a', () => {
		expect(pickTranscoding([t('hls', 'audio/mp4; codecs="mp4a.40.2"')])?.ext).toBe('m4a');
	});

	it('does not mistake the audio/mpegurl ABR playlist for MP3', () => {
		expect(pickTranscoding([t('hls', 'audio/mpegurl'), t('hls', 'audio/mp4; codecs="mp4a.40.2"')])?.ext).toBe('m4a');
	});

	it('skips encrypted HLS and previews', () => {
		expect(pickTranscoding([t('ctr-encrypted-hls', 'audio/mp4'), t('progressive', 'audio/mpeg', true)])).toBeNull();
	});
});
