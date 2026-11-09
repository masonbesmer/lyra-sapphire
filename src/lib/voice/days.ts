/**
 * The days a weather forecast can be asked about, shared by the intent parser, which recognises
 * exactly the phrases in `DAY_PHRASES`, and the forecast action, which reads the same weekdays.
 */

/** Sunday first, in `Date#getUTCDay` order. */
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKEND: ReadonlySet<Weekday> = new Set(['saturday', 'sunday']);

type ForecastDay = 'today' | 'tomorrow' | 'week' | 'weekend' | Weekday;

/** Every spoken day phrase and the forecast day it means. */
export const DAY_PHRASES: Readonly<Record<string, ForecastDay>> = {
	today: 'today',
	tonight: 'today',
	tomorrow: 'tomorrow',
	'this week': 'week',
	'the week': 'week',
	'this weekend': 'weekend',
	'the weekend': 'weekend',
	...(Object.fromEntries(WEEKDAYS.map((day) => [day, day])) as Record<Weekday, Weekday>)
};
