import { describe, expect, it } from 'vitest';
import { normalise, parse } from '../../../src/lib/voice/intents';

describe('normalise', () => {
	it('lower-cases and strips punctuation but keeps apostrophes', () => {
		expect(normalise("What's PLAYING?!")).toBe("what's playing");
	});

	it('turns hyphens into spaces and collapses whitespace', () => {
		expect(normalise('  turn   it-up  ')).toBe('turn it up');
	});

	it('drops a leading wake-word echo', () => {
		expect(normalise('Hey Jarvis, skip this song')).toBe('skip this song');
		expect(normalise('okay lyra pause')).toBe('pause');
	});

	it('collapses number words into digits', () => {
		expect(normalise('volume forty-five')).toBe('volume 45');
		expect(normalise('volume twenty')).toBe('volume 20');
		expect(normalise('ten five')).toBe('10 5');
		expect(normalise('one hundred')).toBe('1 100');
	});

	it('returns an empty string for punctuation-only input', () => {
		expect(normalise('?!...')).toBe('');
	});
});

describe('parse', () => {
	it.each([
		['play never gonna give you up', 'play'],
		['skip', 'skip'],
		['skip this track', 'skip'],
		['next song', 'skip'],
		['hold on', 'pause'],
		['keep going', 'resume'],
		['stop playing', 'stop'],
		['shut up', 'stop'],
		["what's playing", 'nowplaying'],
		['now playing', 'nowplaying'],
		["what's in the queue", 'queue'],
		['queue', 'queue'],
		['shuffle the queue', 'shuffle'],
		['get out', 'disconnect']
	])('matches %j as %s at grammar confidence', (input, intent) => {
		const result = parse(input);
		expect(result?.intent).toBe(intent);
		expect(result?.confidence).toBe(0.95);
	});

	it('captures the play query slot', () => {
		expect(parse('Put on Daft Punk!')).toEqual({
			intent: 'play',
			slots: { query: 'daft punk' },
			confidence: 0.95,
			normalised: 'put on daft punk'
		});
	});

	it('captures the volume_set n slot from spoken numbers', () => {
		expect(parse('set volume to forty five')?.slots).toEqual({ n: '45' });
		expect(parse('volume 80')).toMatchObject({ intent: 'volume_set', slots: { n: '80' } });
	});

	it('captures the volume_rel dir slot', () => {
		expect(parse('turn it up')).toMatchObject({ intent: 'volume_rel', slots: { dir: 'up' } });
		expect(parse('quieter')).toMatchObject({ intent: 'volume_rel', slots: { dir: 'quieter' } });
	});

	it('takes the first matching grammar rule', () => {
		// "queue" alone is the queue intent, but as a play query the earlier play rule wins.
		expect(parse('play queue')).toMatchObject({ intent: 'play', slots: { query: 'queue' } });
	});

	it('fuzzy-matches a near-miss on the leading verb below the silent-dispatch threshold', () => {
		const result = parse('skp');
		expect(result?.intent).toBe('skip');
		expect(result?.slots).toEqual({});
		expect(result?.confidence).toBeGreaterThanOrEqual(0.5);
		expect(result?.confidence).toBeLessThanOrEqual(0.79);
	});

	it('never fuzzy-matches play', () => {
		expect(parse('plya something')).toBeNull();
	});

	it('returns null for empty or unrecognised input', () => {
		expect(parse('')).toBeNull();
		expect(parse('   ')).toBeNull();
		expect(parse('the weather is nice today')).toBeNull();
	});
});
