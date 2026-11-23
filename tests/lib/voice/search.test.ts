import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webSearch } from '../../../src/lib/voice/assistantActions';
import { googleSearch } from '../../../src/lib/voice/search';

let requested: URL[];
let respond: () => Response;

beforeEach(() => {
	requested = [];
	(container as any).logger = { warn: vi.fn() };
	vi.stubEnv('GOOGLE_SEARCH_API_KEY', 'secret-key');
	vi.stubEnv('GOOGLE_SEARCH_CX', 'engine-id');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			requested.push(new URL(input));
			return respond();
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('googleSearch', () => {
	it('returns the top hit with whitespace flattened', async () => {
		respond = () => Response.json({ items: [{ title: 'ABC', snippet: 'line one\nline   two', link: 'https://example.com/abc' }] });
		expect(await googleSearch('abcxyz')).toEqual({ title: 'ABC', snippet: 'line one line two', url: 'https://example.com/abc' });
		expect(requested[0].searchParams.get('q')).toBe('abcxyz');
		expect(requested[0].searchParams.get('cx')).toBe('engine-id');
	});

	it('is null when nothing matched', async () => {
		respond = () => Response.json({});
		expect(await googleSearch('zzz')).toBeNull();
	});

	it("is 'error' on an HTTP failure, without logging the key", async () => {
		respond = () => new Response('nope', { status: 403 });
		expect(await googleSearch('x')).toBe('error');
		expect(JSON.stringify(vi.mocked((container as any).logger.warn).mock.calls)).not.toContain('secret-key');
	});
});

describe('webSearch', () => {
	it('answers with the title and snippet and hands back the link', async () => {
		respond = () => Response.json({ items: [{ title: 'ABC', snippet: 'About abc.', link: 'https://example.com/abc' }] });
		expect(await webSearch('g-search', 'abcxyz')).toEqual({
			ok: true,
			message: 'top result for abcxyz: ABC. About abc.',
			data: { url: 'https://example.com/abc' }
		});
	});

	it('says so when the keys are missing, without calling out', async () => {
		vi.stubEnv('GOOGLE_SEARCH_API_KEY', '');
		expect(await webSearch('g-search', 'abcxyz')).toMatchObject({ ok: false, error: "google search isn't set up yet." });
		expect(requested).toHaveLength(0);
	});

	it('asks what to search for when the query is empty', async () => {
		expect(await webSearch('g-search', undefined)).toMatchObject({ ok: false, code: 'bad_input' });
	});
});

describe('webSearch with Gemini', () => {
	it('prefers the grounded AI answer and sends the key as a header', async () => {
		vi.stubEnv('GEMINI_API_KEY', 'gem-key');
		respond = () =>
			Response.json({
				candidates: [
					{
						content: { parts: [{ text: '**ABC** is a thing.' }] },
						groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/src' } }] }
					}
				]
			});
		expect(await webSearch('g-search', 'abcxyz')).toEqual({ ok: true, message: 'ABC is a thing.', data: { url: 'https://example.com/src' } });
		expect(requested[0].search).toBe('');
		expect(requested[0].pathname).toContain(':generateContent');
	});
});
