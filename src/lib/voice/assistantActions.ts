import { container } from '@sapphire/framework';
import type { ActionResult } from '../musicActions';
import type { ClockTime } from './intents';
import { formatDate, formatDuration, formatTime, nextAlarmTime, resolveTimeZone } from './clock';
import { WEEKDAYS, WEEKEND, type Weekday } from './days';
import { cancel, list, MAX_PENDING_PER_USER, schedule, type TimerKind } from './timers';
import { describeWeatherCode, fetchWeather, geocode, placeLabel, type DayForecast, type Place, type Weather } from './weather';

/**
 * The non-music intents. Every reply is spoken verbatim in `tts` mode, so they are plain short
 * sentences: no markdown, no degree sign, and always the unit by name.
 */

const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const STATUS_LIMIT = 3;
const UNREACHABLE: ActionResult<never> = { ok: false, error: "couldn't reach the weather service.", code: 'internal' };

let warnedTimeZone = false;

function timeZone(): string {
	const { zone, invalid } = resolveTimeZone();
	if (invalid && !warnedTimeZone) {
		warnedTimeZone = true;
		container.logger.warn(`[voice/clock] VOICE_TIMEZONE "${invalid}" is not a valid IANA zone, using ${zone}`);
	}
	return zone;
}

function done(message: string): ActionResult {
	return { ok: true, message, data: undefined };
}

async function findPlace(spoken: string | undefined): Promise<ActionResult<Place>> {
	const place = spoken ?? process.env.VOICE_HOME_LOCATION;
	if (!place) return { ok: false, error: "where? try 'weather in Chicago'.", code: 'bad_input' };
	const found = await geocode(place);
	if (found === 'error') return UNREACHABLE;
	if (!found) return { ok: false, error: `couldn't find a place called ${place}.`, code: 'no_results' };
	return { ok: true, message: '', data: found };
}

async function placeWeather(spoken: string | undefined): Promise<ActionResult<{ place: Place; weather: Weather }>> {
	const place = await findPlace(spoken);
	if (!place.ok) return place;
	const weather = await fetchWeather(place.data);
	if (!weather) return UNREACHABLE;
	return { ok: true, message: '', data: { place: place.data, weather } };
}

export async function tellTime(place: string | undefined): Promise<ActionResult> {
	const now = new Date();
	if (!place) return done(`it's ${formatTime(now, timeZone())}.`);
	const found = await findPlace(place);
	if (!found.ok) return found;
	return done(`it's ${formatTime(now, found.data.timezone)} in ${placeLabel(found.data)}.`);
}

export function tellDate(): ActionResult {
	return done(`it's ${formatDate(new Date(), timeZone())}.`);
}

function scheduled(entry: Parameters<typeof schedule>[0], message: string): ActionResult {
	if (!schedule(entry)) return { ok: false, error: `you've already got ${MAX_PENDING_PER_USER} going — cancel one first.`, code: 'bad_input' };
	return done(message);
}

export function setTimer(guildId: string, userId: string, textChannelId: string | null, ms: number | undefined): ActionResult {
	if (ms === undefined) return { ok: false, error: "how long? say 'set a timer for 5 minutes'.", code: 'bad_input' };
	if (ms > MAX_TIMER_MS) return { ok: false, error: 'timers top out at 24 hours.', code: 'bad_input' };
	const duration = formatDuration(ms);
	return scheduled(
		{ guildId, userId, textChannelId, kind: 'timer', fireAt: Date.now() + ms, label: `timer for ${duration}` },
		`timer set for ${duration}.`
	);
}

export interface AlarmRequest {
	/** "in 20 minutes". */
	ms?: number;
	/** "at 7:30". */
	clock?: ClockTime;
}

export function setAlarm(guildId: string, userId: string, textChannelId: string | null, request: AlarmRequest): ActionResult {
	const zone = timeZone();
	const now = new Date();
	let fireAt: Date;
	if (request.ms !== undefined) {
		if (request.ms > MAX_TIMER_MS) return { ok: false, error: 'alarms have to be within the next 24 hours.', code: 'bad_input' };
		fireAt = new Date(now.getTime() + request.ms);
	} else if (request.clock) {
		fireAt = nextAlarmTime(now, zone, request.clock);
	} else {
		return { ok: false, error: "for when? say 'set an alarm for 7 AM'.", code: 'bad_input' };
	}

	const time = formatTime(fireAt, zone);
	const tomorrow = formatDate(fireAt, zone) !== formatDate(now, zone) ? ' tomorrow' : '';
	return scheduled(
		{ guildId, userId, textChannelId, kind: 'alarm', fireAt: fireAt.getTime(), label: `alarm for ${time}` },
		`alarm set for ${time}${tomorrow}.`
	);
}

export function cancelTimers(guildId: string, userId: string, kind: TimerKind): ActionResult {
	const count = cancel(guildId, userId, kind);
	if (!count) return { ok: false, error: `you don't have any ${kind}s set.`, code: 'bad_input' };
	return done(count === 1 ? `cancelled your ${kind}.` : `cancelled ${count} ${kind}s.`);
}

export function timerStatus(guildId: string, userId: string): ActionResult {
	const entries = list(guildId, userId);
	if (!entries.length) return { ok: false, error: "you don't have any timers or alarms.", code: 'bad_input' };
	const now = Date.now();
	const lines = entries.slice(0, STATUS_LIMIT).map(({ kind, label, fireAt }) => {
		const left = formatDuration(fireAt - now);
		return kind === 'timer' ? `your ${label} has ${left} left` : `your ${label} goes off in ${left}`;
	});
	const more = entries.length > STATUS_LIMIT ? `, and ${entries.length - STATUS_LIMIT} more` : '';
	return done(`${lines.join('; ')}${more}.`);
}

function degrees(value: number, imperial: boolean): string {
	return `${Math.round(value)} degrees ${imperial ? 'Fahrenheit' : 'Celsius'}`;
}

/** `brief` is for the three-day summary, which has to fit three of these in one spoken sentence. */
function rainChance(day: DayForecast, brief = false): string {
	if (day.precipitationChance === null) return '';
	return `, ${day.precipitationChance} percent ${brief ? 'rain' : 'chance of rain'}`;
}

export async function currentWeather(place: string | undefined): Promise<ActionResult> {
	const found = await placeWeather(place);
	if (!found.ok) return found;
	const { weather } = found.data;
	const { current, imperial } = weather;
	const wind = `${Math.round(current.windSpeed)} ${imperial ? 'miles' : 'kilometers'} per hour`;
	let message = `in ${placeLabel(found.data.place)} it's ${degrees(current.temperature, imperial)} and ${describeWeatherCode(current.code)}, feels like ${Math.round(current.feelsLike)}, wind ${wind}.`;
	const today = weather.daily[0];
	if (today) message += ` today's high ${Math.round(today.high)}, low ${Math.round(today.low)}${rainChance(today)}.`;
	return done(message);
}

function weekdayOf(date: string): Weekday {
	// Noon UTC keeps the calendar date the same whatever the offset of the zone it came from.
	return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function dayName(index: number, date: string): string {
	return index === 0 ? 'today' : index === 1 ? 'tomorrow' : weekdayOf(date);
}

/**
 * `day` is today, tomorrow, a weekday, `weekend` or `week`. Open-Meteo's dates are already in
 * the place's own zone, so a weekday is matched against them directly, today included — and
 * every weekday falls inside the seven days fetched. On a Sunday, the weekend is today alone.
 */
export async function forecast(place: string | undefined, day: string | undefined): Promise<ActionResult> {
	const found = await placeWeather(place);
	if (!found.ok) return found;
	const { daily, imperial } = found.data.weather;
	const label = placeLabel(found.data.place);
	const unit = imperial ? 'Fahrenheit' : 'Celsius';

	const index =
		day === 'today'
			? 0
			: day === 'tomorrow'
				? 1
				: day && day !== 'week' && day !== 'weekend'
					? daily.findIndex(({ date }) => weekdayOf(date) === day)
					: -1;
	const single = daily[index];
	if (single) {
		return done(
			`${dayName(index, single.date)} in ${label}: ${describeWeatherCode(single.code)}, high ${Math.round(single.high)}, low ${degrees(single.low, imperial)}${rainChance(single)}.`
		);
	}

	const first = day === 'weekend' ? daily.findIndex(({ date }) => WEEKEND.has(weekdayOf(date))) : 0;
	const count = day === 'weekend' ? (weekdayOf(daily[first].date) === 'saturday' ? 2 : 1) : 3;
	const days = daily
		.slice(first, first + count)
		.map(
			(entry, i) =>
				`${dayName(first + i, entry.date)} ${describeWeatherCode(entry.code)}, high ${Math.round(entry.high)}, low ${Math.round(entry.low)}${rainChance(entry, true)}`
		);
	return done(`${label} in ${unit}: ${days.join('; ')}.`);
}
