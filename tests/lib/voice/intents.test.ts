import { describe, expect, it } from 'vitest';
import { normalise, parse, parseClock, parseDuration } from '../../../src/lib/voice/intents';

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

describe('parse assistant intents', () => {
	it.each([
		['stop the timer', 'timer_cancel', { kind: 'timer' }],
		['cancel my alarm', 'timer_cancel', { kind: 'alarm' }],
		['what time is it', 'time', {}],
		['what time is it in tokyo', 'time', { place: 'tokyo' }],
		['what time is it in new york right now', 'time', { place: 'new york' }],
		['what time is it right now in tokyo', 'time', { place: 'tokyo' }],
		["what's the date", 'date', {}],
		['what day is it', 'date', {}],
		['set a timer for five minutes', 'timer_set', { ms: '300000' }],
		['set a 10 minute timer', 'timer_set', { ms: '600000' }],
		['timer for an hour and a half', 'timer_set', { ms: '5400000' }],
		['set a timer for 2 hours 15 minutes', 'timer_set', { ms: '8100000' }],
		['set a timer', 'timer_set', {}],
		['set an alarm for 7:30 a.m.', 'alarm_set', { h: '7', m: '30', meridiem: 'am' }],
		['wake me up at 6 tomorrow', 'alarm_set', { h: '6', m: '0', day: 'tomorrow' }],
		['set an alarm for 20 minutes', 'alarm_set', { ms: '1200000' }],
		['how much time is left on my timer', 'timer_status', {}],
		["what's the weather", 'weather_current', {}],
		["what's the weather like in new york tomorrow", 'weather_forecast', { place: 'new york', day: 'tomorrow' }],
		['weather forecast for springfield illinois', 'weather_forecast', { place: 'springfield illinois' }],
		['is it going to rain tomorrow', 'weather_forecast', { day: 'tomorrow' }],
		['is it raining', 'weather_current', {}],
		["what's the temperature in paris", 'weather_current', { place: 'paris' }],
		["how's the weather this weekend", 'weather_forecast', { day: 'weekend' }],
		['weather forecast for the week', 'weather_forecast', { day: 'week' }]
	])('matches %j as %s', (input, intent, slots) => {
		expect(parse(input)).toMatchObject({ intent, slots, confidence: 0.95 });
	});

	it('leaves the music grammar exactly as it was', () => {
		expect(parse('stop')).toMatchObject({ intent: 'stop', confidence: 0.95 });
		expect(parse('play stormy weather')).toMatchObject({ intent: 'play', slots: { query: 'stormy weather' } });
		expect(parse("what's playing")?.intent).toBe('nowplaying');
		expect(parse('skip this track')).toMatchObject({ intent: 'skip', confidence: 0.95 });
	});

	it('does not take a timer sentence with a nonsense duration', () => {
		expect(parse('set a timer for banana')?.intent).not.toBe('timer_set');
		expect(parse('alarm in 7')).toBeNull();
	});

	it('strips politeness and still matches at grammar confidence', () => {
		expect(parse('can you tell me what time it is')).toMatchObject({ intent: 'time', confidence: 0.95, normalised: 'what time it is' });
		expect(parse('please skip')).toMatchObject({ intent: 'skip', confidence: 0.95, normalised: 'skip' });
	});

	it('keeps trailing words that may belong to the song title', () => {
		expect(parse('can you play pray for me')).toMatchObject({ intent: 'play', slots: { query: 'pray for me' }, confidence: 0.95 });
		expect(parse('could you play thank you please')).toMatchObject({ slots: { query: 'thank you please' } });
	});

	it('repairs a misheard keyword below the silent-dispatch threshold and names the repair', () => {
		const result = parse('Whats the whether in Chicago?');
		expect(result).toMatchObject({ intent: 'weather_current', slots: { place: 'chicago' }, normalised: 'whats the weather in chicago' });
		expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
		expect(result!.confidence).toBeLessThan(0.8);
		expect(parse('stop the timmer')).toMatchObject({ intent: 'timer_cancel', normalised: 'stop the timer' });
	});

	it('never repairs the words of a place', () => {
		expect(parse('whats the whether in times square')).toMatchObject({
			intent: 'weather_current',
			slots: { place: 'times square' },
			normalised: 'whats the weather in times square'
		});
		expect(parse('what tyme is it in timmins')).toMatchObject({ intent: 'time', slots: { place: 'timmins' } });
		expect(parse('set a timer for five minuts')).toMatchObject({ intent: 'timer_set', slots: { ms: '300000' } });
	});

	it('never routes a repaired keyword to music', () => {
		// "wether" repairs to "weather", but that must not reach play's search query.
		expect(parse('ply the wether')).toBeNull();
		expect(parse('stop the music')).toMatchObject({ intent: 'stop', confidence: 0.79 });
	});
});

describe('parseDuration', () => {
	it.each([
		['5 minutes', 300_000],
		['an hour', 3_600_000],
		['half an hour', 1_800_000],
		['a minute and a half', 90_000],
		['1 hour and 30 minutes', 5_400_000],
		['90 secs', 90_000]
	])('reads %j', (text, ms) => {
		expect(parseDuration(text)).toBe(ms);
	});

	it('rejects anything it cannot account for', () => {
		expect(parseDuration('banana')).toBeNull();
		expect(parseDuration('5 bananas')).toBeNull();
		expect(parseDuration('0 minutes')).toBeNull();
		expect(parseDuration('5')).toBeNull();
	});
});

describe('parseClock', () => {
	it.each([
		['7', { hour: 7, minute: 0, tomorrow: false }],
		['7 30 a m', { hour: 7, minute: 30, meridiem: 'am', tomorrow: false }],
		["6 o'clock tomorrow", { hour: 6, minute: 0, tomorrow: true }],
		['7 oh 5 in the evening', { hour: 7, minute: 5, meridiem: 'pm', tomorrow: false }],
		['19 45', { hour: 19, minute: 45, tomorrow: false }],
		['noon', { hour: 12, minute: 0, meridiem: 'pm', tomorrow: false }],
		['tomorrow at midnight', { hour: 12, minute: 0, meridiem: 'am', tomorrow: true }]
	])('reads %j', (text, clock) => {
		expect(parseClock(text)).toEqual(clock);
	});

	it('rejects impossible times', () => {
		expect(parseClock('25')).toBeNull();
		expect(parseClock('7 75')).toBeNull();
		expect(parseClock('13 pm')).toBeNull();
		expect(parseClock('banana')).toBeNull();
	});
});
