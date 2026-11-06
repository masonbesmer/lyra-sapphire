/**
 * Wall-clock helpers for the time, date and alarm intents. Import-free, like intents.ts, so it
 * runs anywhere Node's bundled ICU does — which formats any IANA zone without tzdata installed.
 */

/**
 * The zone "what time is it" and alarms answer in. `invalid` carries a VOICE_TIMEZONE that was
 * rejected, so the caller can log it; this module stays free of the logger.
 */
export function resolveTimeZone(configured = process.env.VOICE_TIMEZONE): { zone: string; invalid: string | null } {
	const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (!configured) return { zone: fallback, invalid: null };
	try {
		// Throws a RangeError on a name ICU does not know.
		new Intl.DateTimeFormat('en-US', { timeZone: configured });
		return { zone: configured, invalid: null };
	} catch {
		return { zone: fallback, invalid: configured };
	}
}

/** "11:09 PM". ICU puts a narrow no-break space before the meridiem; a speech synthesiser wants a plain one. */
export function formatTime(date: Date, zone: string): string {
	return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(date).replace(/\s/g, ' ');
}

/** "Thursday, November 5". */
export function formatDate(date: Date, zone: string): string {
	return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: zone }).format(date);
}

function plural(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * "1 hour 30 minutes", "3 minutes 12 seconds". Seconds stop mattering once there is an hour to
 * go, so long spans round to the minute.
 */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds >= 3600) {
		const minutes = Math.round(seconds / 60);
		const hours = Math.floor(minutes / 60);
		return [plural(hours, 'hour'), minutes % 60 ? plural(minutes % 60, 'minute') : null].filter(Boolean).join(' ');
	}
	const minutes = Math.floor(seconds / 60);
	if (!minutes) return plural(seconds, 'second');
	return [plural(minutes, 'minute'), seconds % 60 ? plural(seconds % 60, 'second') : null].filter(Boolean).join(' ');
}

const MINUTES_PER_DAY = 1440;

function wallClock(date: Date, zone: string): { hour: number; minute: number; second: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		hourCycle: 'h23',
		timeZone: zone
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	return { hour: part('hour'), minute: part('minute'), second: part('second') };
}

/**
 * The next time the wall clock in `zone` reads `hour24:minute`, never now itself. `tomorrow`
 * skips today's occurrence when there still is one.
 *
 * Counts wall-clock minutes from now, so on a DST transition night the result is off by the
 * shift. An alarm an hour out twice a year is the trade for not carrying a calendar library.
 */
export function nextOccurrence(now: Date, zone: string, hour24: number, minute: number, tomorrow: boolean): Date {
	const wall = wallClock(now, zone);
	const nowMinutes = wall.hour * 60 + wall.minute;
	let delta = (((hour24 * 60 + minute - nowMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
	if (tomorrow && delta < MINUTES_PER_DAY - nowMinutes) delta += MINUTES_PER_DAY;
	return new Date(now.getTime() + delta * 60_000 - wall.second * 1000 - now.getMilliseconds());
}

/**
 * When an alarm for a spoken clock time should ring. "7" with no am or pm means whichever 7
 * comes first; "19" is unambiguous.
 */
export function nextAlarmTime(now: Date, zone: string, clock: { hour: number; minute: number; meridiem?: 'am' | 'pm'; tomorrow: boolean }): Date {
	const { hour, minute, meridiem, tomorrow } = clock;
	if (meridiem) return nextOccurrence(now, zone, (hour % 12) + (meridiem === 'pm' ? 12 : 0), minute, tomorrow);
	if (hour === 0 || hour > 12) return nextOccurrence(now, zone, hour, minute, tomorrow);
	const morning = nextOccurrence(now, zone, hour % 12, minute, tomorrow);
	const evening = nextOccurrence(now, zone, (hour % 12) + 12, minute, tomorrow);
	return morning < evening ? morning : evening;
}
