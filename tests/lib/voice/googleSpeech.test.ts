import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setVoiceAssistantConfig } from '../../../src/lib/config';
import { voiceLanguage } from '../../../src/lib/voice/googleSpeech';
import { transcribe } from '../../../src/lib/voice/sttClient';
import { synthesize } from '../../../src/lib/voice/ttsClient';

let requests: { url: string; headers: Record<string, string>; body: any }[];
let respond: (url: string) => Response;

beforeEach(() => {
	requests = [];
	(container as any).logger = { warn: vi.fn() };
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			requests.push({
				url,
				headers: init.headers as Record<string, string>,
				body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body
			});
			return respond(url);
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('google cloud speech', () => {
	it('reads the language off a voice name', () => {
		expect(voiceLanguage('en-GB-Chirp3-HD-Aoede')).toBe('en-GB');
	});

	it('transcribes through Google with the guild key in a header', async () => {
		setVoiceAssistantConfig({
			guild_id: 'gs-stt',
			stt_provider: 'google',
			stt_language: 'en-GB',
			google_api_key: 'gemini-key',
			google_speech_api_key: 'guild-key'
		});
		respond = () => Response.json({ results: [{ alternatives: [{ transcript: 'skip this song' }] }] });
		expect(await transcribe('gs-stt', new Float32Array(160))).toBe('skip this song');
		expect(requests[0].url).toContain('speech.googleapis.com');
		expect(requests[0].url).not.toContain('guild-key');
		expect(requests[0].headers['x-goog-api-key']).toBe('guild-key');
		expect(requests[0].body.config.languageCode).toBe('en-GB');
	});

	it('falls back to the sidecar when Google fails, without logging the key', async () => {
		setVoiceAssistantConfig({ guild_id: 'gs-fallback', stt_provider: 'google', google_api_key: 'guild-key' });
		respond = (url) => (url.includes('googleapis') ? new Response('quota', { status: 429 }) : Response.json({ text: 'pause' }));
		expect(await transcribe('gs-fallback', new Float32Array(160))).toBe('pause');
		expect(requests).toHaveLength(2);
		expect(JSON.stringify(vi.mocked((container as any).logger.warn).mock.calls)).not.toContain('guild-key');
	});

	it('stays local when google is picked but no key exists anywhere', async () => {
		vi.stubEnv('GEMINI_API_KEY', '');
		setVoiceAssistantConfig({ guild_id: 'gs-nokey', tts_provider: 'google' });
		respond = () => new Response(new Uint8Array([9]));
		expect(await synthesize('gs-nokey', 'hello')).toEqual(new Uint8Array([9]));
		expect(requests[0].url).not.toContain('googleapis');
	});

	it('synthesises with the configured voice', async () => {
		setVoiceAssistantConfig({ guild_id: 'gs-tts', tts_provider: 'google', tts_voice: 'en-US-Neural2-D', google_api_key: 'guild-key' });
		respond = () => Response.json({ audioContent: Buffer.from([1, 2, 3]).toString('base64') });
		expect(await synthesize('gs-tts', '**hello**')).toEqual(new Uint8Array([1, 2, 3]));
		expect(requests[0].body).toMatchObject({ input: { text: 'hello' }, voice: { languageCode: 'en-US', name: 'en-US-Neural2-D' } });
	});
});
