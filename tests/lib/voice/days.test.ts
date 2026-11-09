import { describe, expect, it } from 'vitest';
import { DAY_PHRASES, WEEKDAYS, WEEKEND } from '../../../src/lib/voice/days';
import { parse } from '../../../src/lib/voice/intents';

describe('day vocabulary', () => {
	it('maps exactly these spoken phrases to these forecast days', () => {
		expect(DAY_PHRASES).toStrictEqual({
			today: 'today',
			tonight: 'today',
			tomorrow: 'tomorrow',
			'this week': 'week',
			'the week': 'week',
			'this weekend': 'weekend',
			'the weekend': 'weekend',
			sunday: 'sunday',
			monday: 'monday',
			tuesday: 'tuesday',
			wednesday: 'wednesday',
			thursday: 'thursday',
			friday: 'friday',
			saturday: 'saturday'
		});
	});

	it('orders weekdays as Date#getUTCDay numbers them', () => {
		expect(WEEKDAYS).toStrictEqual(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
		expect([...WEEKEND]).toStrictEqual(['saturday', 'sunday']);
	});

	it.each(Object.entries(DAY_PHRASES))('parses "forecast for %s" as day %s', (phrase, day) => {
		expect(parse(`what's the forecast for ${phrase}`)).toMatchObject({ intent: 'weather_forecast', slots: { day } });
	});
});
