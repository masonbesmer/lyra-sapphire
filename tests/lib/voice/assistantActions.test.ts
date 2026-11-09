import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/voice/playback', () => ({ playAlarm: vi.fn(async () => true) }));
vi.mock('../../../src/lib/voice/weather', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../src/lib/voice/weather')>()),
	geocode: vi.fn(),
	fetchWeather: vi.fn()
}));

import { currentWeather, forecast, setAlarm, setTimer, tellDate, tellTime } from '../../../src/lib/voice/assistantActions';
import { cancel } from '../../../src/lib/voice/timers';
import { fetchWeather, geocode, type Place, type Weather } from '../../../src/lib/voice/weather';

const CHICAGO: Place = {
	name: 'Chicago',
	admin1: 'Illinois',
	country: 'United States',
	countryCode: 'US',
	latitude: 41.85,
	longitude: -87.65,
	timezone: 'America/Chicago'
};
const WEATHER: Weather = {
	imperial: true,
	current: { temperature: 46.6, feelsLike: 41.2, code: 3, windSpeed: 9.4 },
	daily: [
		{ date: '2026-11-05', code: 3, high: 53, low: 45, precipitationChance: 26 },
		{ date: '2026-11-06', code: 61, high: 48, low: 37, precipitationChance: 1 },
		{ date: '2026-11-07', code: 0, high: 50, low: 40, precipitationChance: null },
		{ date: '2026-11-08', code: 71, high: 33, low: 28, precipitationChance: 80 }
	]
};

beforeEach(() => {
	// 11:09 PM on Wednesday, November 4 in Chicago.
	vi.useFakeTimers({ now: new Date('2026-11-05T05:09:42Z') });
	vi.stubEnv('VOICE_TIMEZONE', 'America/Chicago');
	(container as any).logger = { warn: vi.fn() };
	vi.mocked(geocode).mockResolvedValue(CHICAGO);
	vi.mocked(fetchWeather).mockResolvedValue(WEATHER);
});

afterEach(() => {
	cancel('guild', 'user');
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('time and date', () => {
	it('answers in VOICE_TIMEZONE, or in the zone of a named place', async () => {
		expect(await tellTime(undefined)).toMatchObject({ ok: true, message: "it's 11:09 PM." });
		expect(tellDate()).toMatchObject({ ok: true, message: "it's Wednesday, November 4." });
		vi.mocked(geocode).mockResolvedValue({ ...CHICAGO, name: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' });
		expect(await tellTime('tokyo')).toMatchObject({ ok: true, message: "it's 2:09 PM in Tokyo, Japan." });
	});

	it('answers in Chicago when VOICE_TIMEZONE is unset, whatever the server zone', async () => {
		vi.stubEnv('VOICE_TIMEZONE', '');
		vi.stubEnv('TZ', 'Asia/Tokyo');
		expect(await tellTime(undefined)).toMatchObject({ ok: true, message: "it's 11:09 PM." });
		expect(tellDate()).toMatchObject({ ok: true, message: "it's Wednesday, November 4." });
	});

	it('answers a named place in its own zone', async () => {
		vi.mocked(geocode).mockResolvedValue({ ...CHICAGO, name: 'Denver', admin1: 'Colorado', timezone: 'America/Denver' });
		expect(await tellTime('denver colorado')).toMatchObject({ ok: true, message: "it's 10:09 PM in Denver, Colorado." });
		expect(geocode).toHaveBeenLastCalledWith('denver colorado');
	});

	it('tells an unknown place from an unreachable service', async () => {
		vi.mocked(geocode).mockResolvedValue(null);
		expect(await tellTime('atlantis')).toMatchObject({ ok: false, code: 'no_results', error: "couldn't find a place called atlantis." });
		vi.mocked(geocode).mockResolvedValue('error');
		expect(await tellTime('atlantis')).toMatchObject({ ok: false, code: 'internal' });
	});
});

describe('timers and alarms', () => {
	it('asks how long, and refuses a timer over a day', () => {
		expect(setTimer('guild', 'user', null, undefined)).toMatchObject({ ok: false, code: 'bad_input' });
		expect(setTimer('guild', 'user', null, 25 * 3_600_000)).toMatchObject({ ok: false, error: 'timers top out at 24 hours.' });
	});

	it('says when an alarm lands on the next day', () => {
		expect(setAlarm('guild', 'user', null, { clock: { hour: 7, minute: 30, meridiem: 'am', tomorrow: false } })).toMatchObject({
			ok: true,
			message: 'alarm set for 7:30 AM tomorrow.'
		});
		expect(setAlarm('guild', 'user', null, { ms: 20 * 60_000 })).toMatchObject({ ok: true, message: 'alarm set for 11:29 PM.' });
	});

	it('refuses a sixth one', () => {
		for (let i = 0; i < 5; i++) expect(setTimer('guild', 'user', null, 60_000).ok).toBe(true);
		expect(setTimer('guild', 'user', null, 60_000)).toMatchObject({ ok: false, code: 'bad_input' });
	});
});

describe('weather', () => {
	it('reads the current weather with its units named', async () => {
		expect(await currentWeather('chicago')).toMatchObject({
			ok: true,
			message:
				"in Chicago, Illinois it's 47 degrees Fahrenheit and overcast, feels like 41, wind 9 miles per hour. today's high 53, low 45, 26 percent chance of rain."
		});
	});

	it('falls back to VOICE_HOME_LOCATION, and asks where without one', async () => {
		vi.stubEnv('VOICE_HOME_LOCATION', 'Chicago, Illinois');
		await currentWeather(undefined);
		expect(geocode).toHaveBeenLastCalledWith('Chicago, Illinois');
		vi.stubEnv('VOICE_HOME_LOCATION', '');
		expect(await currentWeather(undefined)).toMatchObject({ ok: false, code: 'bad_input' });
	});

	it('forecasts one day, a weekday, or the next three days', async () => {
		expect(await forecast('chicago', 'tomorrow')).toMatchObject({
			message: 'tomorrow in Chicago, Illinois: light rain, high 48, low 37 degrees Fahrenheit, 1 percent chance of rain.'
		});
		expect(await forecast('chicago', 'sunday')).toMatchObject({
			message: 'sunday in Chicago, Illinois: light snow, high 33, low 28 degrees Fahrenheit, 80 percent chance of rain.'
		});
		const week = await forecast('chicago', 'week');
		expect(week).toMatchObject({
			message:
				'Chicago, Illinois in Fahrenheit: today overcast, high 53, low 45, 26 percent rain; tomorrow light rain, high 48, low 37, 1 percent rain; saturday clear, high 50, low 40.'
		});
		expect(week.ok && week.message.length).toBeLessThanOrEqual(240);
	});

	it('forecasts the weekend as its Saturday and Sunday, or Sunday alone on a Sunday', async () => {
		expect(await forecast('chicago', 'weekend')).toMatchObject({
			message: 'Chicago, Illinois in Fahrenheit: saturday clear, high 50, low 40; sunday light snow, high 33, low 28, 80 percent rain.'
		});
		vi.mocked(fetchWeather).mockResolvedValue({ ...WEATHER, daily: WEATHER.daily.slice(3) });
		expect(await forecast('chicago', 'weekend')).toMatchObject({
			message: 'Chicago, Illinois in Fahrenheit: today light snow, high 33, low 28, 80 percent rain.'
		});
	});

	it('reports a failed forecast fetch as unreachable', async () => {
		vi.mocked(fetchWeather).mockResolvedValue(null);
		expect(await forecast('chicago', undefined)).toMatchObject({ ok: false, error: "couldn't reach the weather service." });
	});
});
