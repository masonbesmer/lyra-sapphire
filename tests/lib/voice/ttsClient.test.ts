import { describe, expect, it } from 'vitest';
import { MAX_SPOKEN_CHARS, toSpeech } from '../../../src/lib/voice/ttsClient';

describe('toSpeech', () => {
	it('strips user, role and channel mentions', () => {
		expect(toSpeech('hi <@123> <@!456> <@&789> <#101>')).toBe('hi');
	});

	it('keeps a custom emoji name', () => {
		expect(toSpeech('nice <:pog:123> and <a:dance:456>')).toBe('nice pog and dance');
	});

	it('replaces URLs with "a link"', () => {
		expect(toSpeech('see https://example.com/x?y=1 now')).toBe('see a link now');
	});

	it('strips pictographs and markdown', () => {
		expect(toSpeech('✅ skipped **Song** _by_ `Artist` ~~x~~ ||y||')).toBe('skipped Song by Artist x y');
	});

	it('truncates long text with an ellipsis', () => {
		expect(toSpeech('a'.repeat(MAX_SPOKEN_CHARS + 50))).toBe(`${'a'.repeat(MAX_SPOKEN_CHARS)}…`);
	});

	it('leaves text at the limit untouched', () => {
		const text = 'b'.repeat(MAX_SPOKEN_CHARS);
		expect(toSpeech(text)).toBe(text);
	});
});
