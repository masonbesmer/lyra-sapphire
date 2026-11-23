import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setVoiceAssistantConfig } from '../../../src/lib/config';
import { webSearch } from '../../../src/lib/voice/assistantActions';

let requested: { url: URL; key: string }[];
let respond: () => Response;

beforeEach(() => {
	requested = [];
	(container as any).logger = { warn: vi.fn() };
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init: RequestInit) => {
			requested.push({ url: new URL(input), key: (init.headers as Record<string, string>)['x-goog-api-key'] });
			return respond();
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('webSearch', () => {
	it('says so when the server has no Gemini key, without calling out, even with the old env var', async () => {
		vi.stubEnv('GEMINI_API_KEY', 'env-key');
		expect(await webSearch('ws-nokey', 'abcxyz')).toMatchObject({ ok: false, error: expect.stringContaining('dashboard') });
		expect(requested).toHaveLength(0);
	});

	it('asks what to search for when the query is empty', async () => {
		expect(await webSearch('ws-nokey', undefined)).toMatchObject({ ok: false, code: 'bad_input' });
	});

	it("answers with Gemini grounded in search, using the server's key as a header", async () => {
		setVoiceAssistantConfig({ guild_id: 'ws-key', google_api_key: 'gem-key' });
		respond = () =>
			Response.json({
				candidates: [
					{
						content: { parts: [{ text: '**ABC** is a thing.' }] },
						groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/src' } }] }
					}
				]
			});
		expect(await webSearch('ws-key', 'abcxyz')).toEqual({ ok: true, message: 'ABC is a thing.', data: { url: 'https://example.com/src' } });
		expect(requested[0].url.search).toBe('');
		expect(requested[0].url.pathname).toContain(':generateContent');
		expect(requested[0].key).toBe('gem-key');
	});

	it("is 'couldn't reach google' on an HTTP failure", async () => {
		setVoiceAssistantConfig({ guild_id: 'ws-err', google_api_key: 'gem-key' });
		respond = () => new Response('quota', { status: 429 });
		expect(await webSearch('ws-err', 'x')).toMatchObject({ ok: false, error: "couldn't reach google." });
	});
});
