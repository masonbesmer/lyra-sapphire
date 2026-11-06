import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeWeatherCode, fetchWeather, geocode, placeLabel, type Place } from '../../../src/lib/voice/weather';

const SPRINGFIELD = {
	name: 'Springfield',
	admin1: 'Illinois',
	country: 'United States',
	country_code: 'US',
	latitude: 39.8,
	longitude: -89.64,
	timezone: 'America/Chicago'
};

let requested: URL[];
let respond: (url: URL) => Response;

beforeEach(() => {
	requested = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			const url = new URL(input);
			requested.push(url);
			return respond(url);
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('geocode', () => {
	it('puts back the comma normalise stripped when the bare name finds nothing', async () => {
		respond = (url) => Response.json(url.searchParams.get('name') === 'springfield, illinois' ? { results: [SPRINGFIELD] } : {});
		expect(await geocode('Springfield Illinois')).toMatchObject({ name: 'Springfield', countryCode: 'US', timezone: 'America/Chicago' });
		expect(requested.map((url) => url.searchParams.get('name'))).toEqual(['springfield illinois', 'springfield, illinois']);

		// Cached: no second round trip.
		await geocode('springfield illinois');
		expect(requested).toHaveLength(2);
	});

	it('tries the comma further left for a multi-word region', async () => {
		respond = () => Response.json({});
		expect(await geocode('new york new york')).toBeNull();
		expect(requested.map((url) => url.searchParams.get('name'))).toEqual([
			'new york new york',
			'new york new, york',
			'new york, new york',
			'new, york new york'
		]);
	});

	it('reports an unreachable service as an error, not as nowhere', async () => {
		respond = () => new Response('down', { status: 503 });
		expect(await geocode('somewhere unseen')).toBe('error');
	});
});

describe('fetchWeather', () => {
	const place = (countryCode: string): Place => ({ name: 'X', countryCode, latitude: 1, longitude: 2, timezone: 'UTC' });
	const body = {
		current: { temperature_2m: 46.6, apparent_temperature: 41, weather_code: 3, wind_speed_10m: 9 },
		daily: { time: ['2026-11-05'], weather_code: [61], temperature_2m_max: [53], temperature_2m_min: [45], precipitation_probability_max: [26] }
	};

	it('asks for Fahrenheit and mph in the US, and the metric defaults elsewhere', async () => {
		respond = () => Response.json(body);
		expect(await fetchWeather(place('US'))).toEqual({
			imperial: true,
			current: { temperature: 46.6, feelsLike: 41, code: 3, windSpeed: 9 },
			daily: [{ date: '2026-11-05', code: 61, high: 53, low: 45, precipitationChance: 26 }]
		});
		expect(requested[0].searchParams.get('temperature_unit')).toBe('fahrenheit');
		expect(requested[0].searchParams.get('wind_speed_unit')).toBe('mph');

		expect((await fetchWeather(place('JP')))?.imperial).toBe(false);
		expect(requested[1].searchParams.has('temperature_unit')).toBe(false);
	});

	it('returns null instead of throwing when the request fails', async () => {
		respond = () => {
			throw new TypeError('fetch failed');
		};
		expect(await fetchWeather(place('US'))).toBeNull();
	});
});

describe('labels', () => {
	it('names the US state at home and the country abroad', () => {
		expect(
			placeLabel({
				name: 'Chicago',
				admin1: 'Illinois',
				country: 'United States',
				countryCode: 'US',
				latitude: 0,
				longitude: 0,
				timezone: 'UTC'
			})
		).toBe('Chicago, Illinois');
		expect(placeLabel({ name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', latitude: 0, longitude: 0, timezone: 'UTC' })).toBe(
			'Tokyo, Japan'
		);
	});

	it('describes WMO codes, with a fallback for unknown ones', () => {
		expect(describeWeatherCode(0)).toBe('clear');
		expect(describeWeatherCode(63)).toBe('moderate rain');
		expect(describeWeatherCode(99)).toBe('thunderstorms with hail');
		expect(describeWeatherCode(42)).toBe('unsettled');
	});
});
