import { describe, expect, it } from 'vitest';
import { formatDate, formatDuration, formatTime, nextAlarmTime, nextOccurrence, resolveTimeZone } from '../../../src/lib/voice/clock';

// 11:09:42 PM on Wednesday, November 4 in Chicago (CST); 2:09 PM on Thursday, November 5 in Tokyo.
const NOW = new Date('2026-11-05T05:09:42.500Z');

describe('resolveTimeZone', () => {
	it('uses a valid VOICE_TIMEZONE', () => {
		expect(resolveTimeZone('Asia/Tokyo')).toEqual({ zone: 'Asia/Tokyo', invalid: null });
	});

	it('defaults to Chicago when unset, and reports an invalid one', () => {
		expect(resolveTimeZone('')).toEqual({ zone: 'America/Chicago', invalid: null });
		expect(resolveTimeZone('Nowhere/Fake')).toEqual({ zone: 'America/Chicago', invalid: 'Nowhere/Fake' });
	});
});

describe('formatTime and formatDate', () => {
	it('formats in the given zone with plain spaces', () => {
		expect(formatTime(NOW, 'America/Chicago')).toBe('11:09 PM');
		expect(formatTime(NOW, 'Asia/Tokyo')).toBe('2:09 PM');
		expect(formatDate(NOW, 'America/Chicago')).toBe('Wednesday, November 4');
		expect(formatDate(NOW, 'Asia/Tokyo')).toBe('Thursday, November 5');
	});
});

describe('formatDuration', () => {
	it.each([
		[45_000, '45 seconds'],
		[1_000, '1 second'],
		[60_000, '1 minute'],
		[192_000, '3 minutes 12 seconds'],
		[5_400_000, '1 hour 30 minutes'],
		[7 * 3_600_000 + 59 * 60_000 + 43_000, '8 hours'],
		[0, '0 seconds']
	])('formats %i ms as %j', (ms, text) => {
		expect(formatDuration(ms)).toBe(text);
	});
});

describe('nextOccurrence', () => {
	it('finds the next wall-clock time on the minute', () => {
		expect(nextOccurrence(NOW, 'America/Chicago', 7, 30, false).toISOString()).toBe('2026-11-05T13:30:00.000Z');
		expect(nextOccurrence(NOW, 'Asia/Tokyo', 7, 30, false).toISOString()).toBe('2026-11-05T22:30:00.000Z');
		expect(nextOccurrence(NOW, 'Asia/Tokyo', 18, 0, false).toISOString()).toBe('2026-11-05T09:00:00.000Z');
	});

	it('never returns now itself', () => {
		expect(nextOccurrence(NOW, 'Asia/Tokyo', 14, 9, false).toISOString()).toBe('2026-11-06T05:09:00.000Z');
	});

	it('skips a time still to come today when asked for tomorrow', () => {
		expect(nextOccurrence(NOW, 'Asia/Tokyo', 18, 0, true).toISOString()).toBe('2026-11-06T09:00:00.000Z');
		// At 11:09 PM the next 7:30 already falls tomorrow, so nothing is added.
		expect(nextOccurrence(NOW, 'America/Chicago', 7, 30, true).toISOString()).toBe('2026-11-05T13:30:00.000Z');
	});
});

describe('nextAlarmTime', () => {
	it('picks whichever reading of an ambiguous hour comes first', () => {
		expect(nextAlarmTime(NOW, 'America/Chicago', { hour: 7, minute: 0, tomorrow: false }).toISOString()).toBe('2026-11-05T13:00:00.000Z');
		expect(nextAlarmTime(NOW, 'Asia/Tokyo', { hour: 7, minute: 0, tomorrow: false }).toISOString()).toBe('2026-11-05T10:00:00.000Z');
	});

	it('honours an explicit meridiem and a 24-hour time', () => {
		expect(nextAlarmTime(NOW, 'Asia/Tokyo', { hour: 7, minute: 0, meridiem: 'am', tomorrow: false }).toISOString()).toBe(
			'2026-11-05T22:00:00.000Z'
		);
		expect(nextAlarmTime(NOW, 'Asia/Tokyo', { hour: 12, minute: 0, meridiem: 'am', tomorrow: false }).toISOString()).toBe(
			'2026-11-05T15:00:00.000Z'
		);
		expect(nextAlarmTime(NOW, 'Asia/Tokyo', { hour: 19, minute: 15, tomorrow: false }).toISOString()).toBe('2026-11-05T10:15:00.000Z');
	});
});
