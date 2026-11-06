/**
 * Weather and place lookups through Open-Meteo, which needs no API key.
 *
 * Nothing here throws. Like the STT and TTS clients it runs on the utterance path, and a
 * weather service being down must cost one answer, not the listener.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 5_000;
const GEOCODE_CACHE_SIZE = 100;
/** The countries that still measure weather in Fahrenheit and miles. */
const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM']);

export interface Place {
	name: string;
	admin1?: string;
	country?: string;
	countryCode: string;
	latitude: number;
	longitude: number;
	/** IANA zone, which is also what answers "what time is it in Tokyo". */
	timezone: string;
}

export interface DayForecast {
	/** `YYYY-MM-DD` in the place's own zone. */
	date: string;
	code: number;
	high: number;
	low: number;
	precipitationChance: number | null;
}

export interface Weather {
	imperial: boolean;
	current: { temperature: number; feelsLike: number; code: number; windSpeed: number };
	daily: DayForecast[];
}

interface GeocodingResponse {
	results?: Array<{
		name: string;
		admin1?: string;
		country?: string;
		country_code: string;
		latitude: number;
		longitude: number;
		timezone: string;
	}>;
}

interface ForecastResponse {
	current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
	daily: {
		time: string[];
		weather_code: number[];
		temperature_2m_max: number[];
		temperature_2m_min: number[];
		precipitation_probability_max: Array<number | null>;
	};
}

const geocodeCache = new Map<string, Place>();

async function getJson<T>(url: string): Promise<T | 'error'> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!response.ok) return 'error';
		return (await response.json()) as T;
	} catch {
		return 'error';
	}
}

/**
 * The search queries to try for a spoken place, in order. Open-Meteo finds "springfield,
 * illinois" but not "springfield illinois", and normalise has already stripped the comma, so
 * each later query puts one back a word further left.
 */
function geocodeQueries(place: string): string[] {
	const words = place.split(' ');
	const queries = [place];
	for (let split = words.length - 1; split >= 1; split--) queries.push(`${words.slice(0, split).join(' ')}, ${words.slice(split).join(' ')}`);
	return queries;
}

/** Null when nowhere by that name exists; `'error'` when the service could not be asked. */
export async function geocode(place: string): Promise<Place | null | 'error'> {
	const key = place.trim().toLowerCase();
	const cached = geocodeCache.get(key);
	if (cached) return cached;

	for (const query of geocodeQueries(key)) {
		const body = await getJson<GeocodingResponse>(
			`${GEOCODING_URL}?${new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' })}`
		);
		if (body === 'error') return 'error';
		const hit = body.results?.[0];
		if (!hit) continue;

		const found: Place = {
			name: hit.name,
			admin1: hit.admin1,
			country: hit.country,
			countryCode: hit.country_code,
			latitude: hit.latitude,
			longitude: hit.longitude,
			timezone: hit.timezone
		};
		if (geocodeCache.size >= GEOCODE_CACHE_SIZE) geocodeCache.delete(geocodeCache.keys().next().value!);
		geocodeCache.set(key, found);
		return found;
	}
	return null;
}

/** Seven days of forecast, today first, in the units the place itself uses. */
export async function fetchWeather(place: Place): Promise<Weather | null> {
	const imperial = IMPERIAL_COUNTRIES.has(place.countryCode);
	const params = new URLSearchParams({
		latitude: String(place.latitude),
		longitude: String(place.longitude),
		timezone: 'auto',
		forecast_days: '7',
		current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
		daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
	});
	if (imperial) {
		params.set('temperature_unit', 'fahrenheit');
		params.set('wind_speed_unit', 'mph');
	}

	const body = await getJson<ForecastResponse>(`${FORECAST_URL}?${params}`);
	if (body === 'error' || !body.current || !body.daily?.time) return null;

	const { current, daily } = body;
	return {
		imperial,
		current: {
			temperature: current.temperature_2m,
			feelsLike: current.apparent_temperature,
			code: current.weather_code,
			windSpeed: current.wind_speed_10m
		},
		daily: daily.time.map((date, i) => ({
			date,
			code: daily.weather_code[i],
			high: daily.temperature_2m_max[i],
			low: daily.temperature_2m_min[i],
			precipitationChance: daily.precipitation_probability_max[i] ?? null
		}))
	};
}

/** WMO weather interpretation codes, as Open-Meteo reports them. */
export function describeWeatherCode(code: number): string {
	if (code === 0) return 'clear';
	if (code === 1) return 'mostly clear';
	if (code === 2) return 'partly cloudy';
	if (code === 3) return 'overcast';
	if (code === 45 || code === 48) return 'foggy';
	if (code >= 51 && code <= 55) return 'drizzle';
	if (code === 56 || code === 57) return 'freezing drizzle';
	if (code === 61) return 'light rain';
	if (code === 63) return 'moderate rain';
	if (code === 65) return 'heavy rain';
	if (code === 66 || code === 67) return 'freezing rain';
	if (code === 71) return 'light snow';
	if (code === 73) return 'moderate snow';
	if (code === 75) return 'heavy snow';
	if (code === 77) return 'snow grains';
	if (code >= 80 && code <= 82) return 'rain showers';
	if (code === 85 || code === 86) return 'snow showers';
	if (code === 95) return 'thunderstorms';
	if (code === 96 || code === 99) return 'thunderstorms with hail';
	return 'unsettled';
}

/** "Chicago, Illinois" at home, "Tokyo, Japan" abroad — the US state is what tells the Springfields apart. */
export function placeLabel(place: Place): string {
	const qualifier = place.countryCode === 'US' ? place.admin1 : place.country;
	return qualifier && qualifier !== place.name ? `${place.name}, ${qualifier}` : place.name;
}
