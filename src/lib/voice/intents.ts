/**
 * Grammar-first intent parsing.
 *
 * Whisper on a 1–3 second command is accurate enough that a hand-written grammar beats an
 * NLU model here, and it is debuggable: when a command is misread you can see exactly which
 * pattern did or did not match.
 */

const MUSIC_INTENT_NAMES = [
	'play',
	'skip',
	'pause',
	'resume',
	'stop',
	'volume_set',
	'volume_rel',
	'nowplaying',
	'queue',
	'shuffle',
	'disconnect'
] as const;

export type MusicIntent = (typeof MUSIC_INTENT_NAMES)[number];
export type AssistantIntent = 'time' | 'date' | 'timer_set' | 'alarm_set' | 'timer_cancel' | 'timer_status' | 'weather_current' | 'weather_forecast';
export type Intent = MusicIntent | AssistantIntent;

/** The intents that drive the music player, and so carry its slash commands' permission gates. */
export const MUSIC_INTENTS: ReadonlySet<Intent> = new Set(MUSIC_INTENT_NAMES);

export interface ParsedIntent {
	intent: Intent;
	slots: Record<string, string>;
	/** >=0.8 dispatch silently, 0.5–0.8 dispatch with an ack naming what was heard. */
	confidence: number;
	/** What the parser actually matched against, after normalisation. */
	normalised: string;
}

const GRAMMAR_CONFIDENCE = 0.95;
/** Fuzzy hits stay under 0.8 on purpose, so they always ack rather than acting silently. */
const FUZZY_CEILING = 0.79;
const FUZZY_FLOOR = 0.5;

const NUMBER_WORDS: Record<string, number> = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50,
	sixty: 60,
	seventy: 70,
	eighty: 80,
	ninety: 90,
	hundred: 100
};

/**
 * Collapses number words into digits so the volume grammar only has to match `\d`.
 * Handles the compound forms people actually say — "forty five", "twenty-five".
 */
function expandNumbers(text: string): string {
	const tokens = text.split(' ');
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const tens = NUMBER_WORDS[tokens[i]];
		if (tens === undefined) {
			out.push(tokens[i]);
			continue;
		}
		const ones = NUMBER_WORDS[tokens[i + 1]];
		if (tens >= 20 && tens <= 90 && tens % 10 === 0 && ones !== undefined && ones < 10) {
			out.push(String(tens + ones));
			i++;
		} else {
			out.push(String(tens));
		}
	}
	return out.join(' ');
}

export function normalise(transcript: string): string {
	return expandNumbers(
		transcript
			.toLowerCase()
			// Whisper punctuates; the grammar does not care. Apostrophes stay for "what's".
			.replace(/[^a-z0-9'\s-]/g, ' ')
			.replace(/-/g, ' ')
			// A wake-word echo often survives into the utterance because of the pre-roll.
			.replace(/^\s*(hey|hi|ok|okay)\s+\w+\s*/, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/**
 * One grammar rule. A `slots` hook turns the named groups into slots, and returns null when the
 * groups do not actually make sense — "set a timer for banana" — so the scan moves on.
 */
interface Rule<I extends Intent> {
	intent: I;
	pattern: RegExp;
	slots?: (groups: Record<string, string | undefined>) => Record<string, string> | null;
}

/** Ordered: first match wins. */
const GRAMMAR: Array<Rule<MusicIntent>> = [
	{ intent: 'play', pattern: /^(?:play|put on|queue up)\s+(?<query>.+)$/ },
	// Allows the natural two-word tails people actually say — "skip this track", "skip the song".
	{
		intent: 'skip',
		pattern: /^(?:skip|next)(?: (?:this|the|it))?(?: (?:one|song|track))?$/
	},
	{ intent: 'pause', pattern: /^(?:pause|hold on|wait)$/ },
	{ intent: 'resume', pattern: /^(?:resume|unpause|continue|keep going)$/ },
	{ intent: 'stop', pattern: /^(?:stop playing|stop|shut up)$/ },
	{ intent: 'volume_set', pattern: /^(?:set )?volume(?: to)? (?<n>\d{1,3})$/ },
	{
		intent: 'volume_rel',
		pattern: /^(?:turn it |volume )?(?<dir>up|down|louder|quieter)$/
	},
	{
		intent: 'nowplaying',
		pattern: /^(?:what(?:'s| is) (?:this|playing)|now playing)$/
	},
	{
		intent: 'queue',
		pattern: /^(?:what's (?:in the )?queue|show queue|queue)$/
	},
	{ intent: 'shuffle', pattern: /^shuffle(?: the queue)?$/ },
	{ intent: 'disconnect', pattern: /^(?:leave|disconnect|get out)$/ }
];

const UNIT_MS: Record<string, number> = {
	second: 1_000,
	sec: 1_000,
	minute: 60_000,
	min: 60_000,
	hour: 3_600_000,
	hr: 3_600_000
};

function unitMs(token: string | undefined): number | undefined {
	if (!token) return undefined;
	return UNIT_MS[token] ?? (token.endsWith('s') ? UNIT_MS[token.slice(0, -1)] : undefined);
}

/**
 * "5 minutes", "an hour and a half", "2 hours 15 minutes", "half an hour". Number words are
 * already digits by the time this runs. Null on anything it cannot account for, so a rule built
 * on it does not swallow a sentence it only half understood.
 */
export function parseDuration(text: string): number | null {
	const tokens = text.split(' ').filter(Boolean);
	let total = 0;
	let i = 0;
	while (i < tokens.length) {
		if (tokens[i] === 'and' && i > 0) {
			i++;
			continue;
		}
		const halfOf = tokens[i] === 'half' && (tokens[i + 1] === 'a' || tokens[i + 1] === 'an') ? unitMs(tokens[i + 2]) : undefined;
		if (halfOf) {
			total += halfOf / 2;
			i += 3;
			continue;
		}
		const count = /^\d+$/.test(tokens[i]) ? Number(tokens[i]) : tokens[i] === 'a' || tokens[i] === 'an' ? 1 : null;
		const unit = unitMs(tokens[i + 1]);
		if (count === null || !unit) return null;
		total += count * unit;
		i += 2;
		if (tokens[i] === 'and' && tokens[i + 1] === 'a' && tokens[i + 2] === 'half') {
			total += unit / 2;
			i += 3;
		}
	}
	return total > 0 ? total : null;
}

export interface ClockTime {
	hour: number;
	minute: number;
	meridiem?: 'am' | 'pm';
	tomorrow: boolean;
}

const MERIDIEM_PHRASES: Array<[RegExp, 'am' | 'pm']> = [
	[/ (?:am|a m|in the morning|this morning)$/, 'am'],
	[/ (?:pm|p m|in the afternoon|this afternoon|in the evening|this evening|at night|tonight)$/, 'pm']
];

/**
 * "7 30 a m", "6 o'clock", "7 oh 5 in the morning", "noon", with "tomorrow" anywhere. Whisper's
 * "7:30 a.m." arrives here as "7 30 a m", because normalise strips the punctuation.
 */
export function parseClock(text: string): ClockTime | null {
	const tomorrow = / tomorrow /.test(` ${text} `);
	let rest = ` ${` ${text} `.replace(/ tomorrow /g, ' ').trim()}`;

	let meridiem: 'am' | 'pm' | undefined;
	for (const [phrase, value] of MERIDIEM_PHRASES) {
		if (!phrase.test(rest)) continue;
		meridiem = value;
		rest = rest.replace(phrase, '');
		break;
	}
	rest = rest.trim().replace(/^at /, '');

	if (!meridiem && rest === 'noon') return { hour: 12, minute: 0, meridiem: 'pm', tomorrow };
	if (!meridiem && rest === 'midnight') return { hour: 12, minute: 0, meridiem: 'am', tomorrow };

	const found = /^(?<h>\d{1,2})(?: (?:(?<mm>\d{2})|oh (?<m>\d)|o'clock))?$/.exec(rest);
	if (!found?.groups) return null;
	const hour = Number(found.groups.h);
	const minute = Number(found.groups.mm ?? found.groups.m ?? 0);
	if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return null;
	return { hour, minute, meridiem, tomorrow };
}

function durationSlots(text: string | undefined): Record<string, string> | null {
	const ms = text ? parseDuration(text) : null;
	return ms === null ? null : { ms: String(ms) };
}

function alarmSlots({ prep, when }: Record<string, string | undefined>): Record<string, string> | null {
	if (!when) return null;
	const duration = durationSlots(when);
	if (duration || prep === 'in') return duration;
	const clock = parseClock(when);
	if (!clock) return null;
	const slots: Record<string, string> = {
		h: String(clock.hour),
		m: String(clock.minute)
	};
	if (clock.meridiem) slots.meridiem = clock.meridiem;
	if (clock.tomorrow) slots.day = 'tomorrow';
	return slots;
}

const DAY =
	/(?:^| )(?:on |for )?(?<day>today|tonight|tomorrow|this week|the week|this weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?= |$)/;
const WEEK_PHRASES = new Set(['this week', 'the week', 'this weekend']);
/** Words that pad a weather question without changing it: "what's the weather going to be like outside". */
const WEATHER_PADDING = /^(?:like|going to be|gonna be|be|outside|currently|right now|now)(?: |$)|(?:^| )(?:like|outside|currently|right now|now)$/;

/**
 * Splits the tail of a weather question into a day and a place. Anything left over that is not
 * a place means the sentence was about something else — "the weather is nice today" — so it is
 * not a match. Both weather intents share the patterns; `wanted` says which one this rule is.
 */
function weatherSlots(
	{ pre, kw, rest }: Record<string, string | undefined>,
	wanted: 'weather_current' | 'weather_forecast'
): Record<string, string> | null {
	let tail = rest ?? '';
	let forecast = kw === 'forecast';
	if (/^forecast(?: |$)/.test(tail)) {
		forecast = true;
		tail = tail.slice('forecast'.length).trim();
	}

	let day = pre?.includes("tomorrow's") ? 'tomorrow' : undefined;
	const dayMatch = DAY.exec(tail);
	if (dayMatch?.groups) {
		const said = dayMatch.groups.day;
		day = said === 'tonight' ? 'today' : WEEK_PHRASES.has(said) ? 'week' : said;
		tail = `${tail.slice(0, dayMatch.index)} ${tail.slice(dayMatch.index + dayMatch[0].length)}`.trim();
	}
	for (let before = ''; before !== tail;) {
		before = tail;
		tail = tail.replace(WEATHER_PADDING, '').trim();
	}

	let place: string | undefined;
	if (tail) {
		const placeMatch = /^(?:in|at|for|near) (?<place>.+)$/.exec(tail);
		if (!placeMatch?.groups) return null;
		place = placeMatch.groups.place;
	}

	const precipitation = kw !== undefined && /^(?:rain|snow)/.test(kw);
	const isForecast = forecast || (precipitation && day !== undefined) || (day !== undefined && day !== 'today');
	if (isForecast !== (wanted === 'weather_forecast')) return null;

	const slots: Record<string, string> = {};
	if (place) slots.place = place;
	if (day) slots.day = day;
	return slots;
}

const WHAT = "(?:what's|whats|what is)";
const WEATHER_QUESTION = new RegExp(
	`^(?:(?:${WHAT}|how's|hows|how is|give me|get|tell me|show me) )?(?<pre>(?:(?:the|current|today's|tomorrow's) )*)(?<kw>weather|forecast|temperature)(?: (?<rest>.+))?$`
);
const PRECIPITATION_QUESTION = /^(?:is|will) it (?:going to |gonna )?(?:be )?(?<kw>rain|raining|snow|snowing)(?: (?<rest>.+))?$/;

/**
 * Everything that is not music. Kept apart from GRAMMAR so the keyword-correction pass can
 * target it alone: a corrected word must never reach a music rule, least of all `play`'s
 * search query.
 */
const ASSISTANT_GRAMMAR: Array<Rule<AssistantIntent>> = [
	{
		intent: 'time',
		pattern: new RegExp(
			`^(?:what time (?:is it|it is)|${WHAT} the (?:current )?time|do you have the time|(?:the )?current time)(?: right now| now)?(?: (?:in|at) (?<place>.+))?$`
		)
	},
	{
		intent: 'date',
		pattern: new RegExp(`^(?:${WHAT} (?:the date(?: today)?|today's date|today)|what day is it(?: today)?)$`)
	},
	// Before timer_set, whose "<duration> timer" form would otherwise be tried on "stop the timer".
	{
		intent: 'timer_cancel',
		pattern: /^(?:cancel|stop|delete|clear|turn off|never mind|end)(?: (?:the|my|all(?: (?:my|the))?))? (?<kind>timer|alarm)s?$/
	},
	{
		intent: 'timer_status',
		pattern:
			/^(?:how (?:much time|long) is left(?: on (?:the|my) (?:timer|alarm))?|what timers do i have|(?:list|show|check)(?: (?:my|the))? (?:timers?|alarms?)|when is my alarm|when does my alarm go off)$/
	},
	{
		intent: 'timer_set',
		pattern: /^(?:(?:set|start|make) )?(?:(?:a|an) )?timer(?: (?:for|of))?(?: (?<dur>.+))?$/,
		// No duration at all is still a timer request; the handler asks how long.
		slots: ({ dur }) => (dur ? durationSlots(dur) : {})
	},
	{
		intent: 'timer_set',
		pattern: /^(?:(?:set|start|make) )?(?:(?:a|an) )?(?<dur>.+) timer$/,
		slots: ({ dur }) => durationSlots(dur)
	},
	{
		intent: 'timer_set',
		pattern: /^remind me in (?<dur>.+)$/,
		slots: ({ dur }) => durationSlots(dur)
	},
	{
		intent: 'alarm_set',
		pattern: /^(?:set )?(?:(?:a|an|my) )?alarm (?<prep>for|at|in) (?<when>.+)$/,
		slots: alarmSlots
	},
	{
		intent: 'alarm_set',
		pattern: /^wake me(?: up)? (?<prep>at|in) (?<when>.+)$/,
		slots: alarmSlots
	},
	{
		intent: 'weather_forecast',
		pattern: WEATHER_QUESTION,
		slots: (groups) => weatherSlots(groups, 'weather_forecast')
	},
	{
		intent: 'weather_current',
		pattern: WEATHER_QUESTION,
		slots: (groups) => weatherSlots(groups, 'weather_current')
	},
	{
		intent: 'weather_forecast',
		pattern: PRECIPITATION_QUESTION,
		slots: (groups) => weatherSlots(groups, 'weather_forecast')
	},
	{
		intent: 'weather_current',
		pattern: PRECIPITATION_QUESTION,
		slots: (groups) => weatherSlots(groups, 'weather_current')
	}
];

const FULL_GRAMMAR: ReadonlyArray<Rule<Intent>> = [...GRAMMAR, ...ASSISTANT_GRAMMAR];

/** Leading verbs the fuzzy pass will accept a near-miss on. */
const FUZZY_VERBS: Array<{ word: string; intent: Intent }> = [
	{ word: 'skip', intent: 'skip' },
	{ word: 'next', intent: 'skip' },
	{ word: 'pause', intent: 'pause' },
	{ word: 'resume', intent: 'resume' },
	{ word: 'stop', intent: 'stop' },
	{ word: 'shuffle', intent: 'shuffle' },
	{ word: 'queue', intent: 'queue' },
	{ word: 'leave', intent: 'disconnect' },
	{ word: 'disconnect', intent: 'disconnect' }
];

/** Words the correction pass will repair a near-miss to. Order breaks ties. */
const KEYWORDS = [
	'weather',
	'forecast',
	'temperature',
	'timer',
	'timers',
	'alarm',
	'alarms',
	'time',
	'minute',
	'minutes',
	'hour',
	'hours',
	'second',
	'seconds',
	'cancel'
];
const KEYWORD_SET = new Set(KEYWORDS);
const KEYWORD_MIN_LENGTH = 4;
const KEYWORD_MIN_SCORE = 0.7;

const LEADING_FILLER =
	/^(?:lyra|please|can you|could you|would you|will you|tell me|do you know|i want to know|i'd like to know|let me know|hey)(?: |$)/;
const TRAILING_FILLER = /(?:^| )(?:please|for me|thanks|thank you)$/;

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const prev = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = prev[j];
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = tmp;
		}
	}
	return prev[b.length];
}

function similarity(a: string, b: string): number {
	return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Drops the politeness around a command — "can you tell me what time it is please". */
function stripFiller(text: string): string {
	let out = text;
	for (let before = ''; before !== out;) {
		before = out;
		out = out.replace(LEADING_FILLER, '').replace(TRAILING_FILLER, '').trim();
	}
	return out;
}

/**
 * Repairs Whisper's near-misses on the words the assistant grammar keys on — "whether" for
 * "weather". Words already in the lexicon are left alone, which is what keeps "time" from
 * becoming "timer". The score is the weakest repair made, so one bad guess caps the whole match.
 */
function correctKeywords(text: string): { text: string; score: number } | null {
	let lowest = 1;
	let changed = false;
	const tokens = text.split(' ').map((token) => {
		if (token.length < KEYWORD_MIN_LENGTH || KEYWORD_SET.has(token)) return token;
		let best = { word: token, score: 0 };
		for (const word of KEYWORDS) {
			const score = similarity(token, word);
			if (score > best.score) best = { word, score };
		}
		if (best.score < KEYWORD_MIN_SCORE) return token;
		changed = true;
		lowest = Math.min(lowest, best.score);
		return best.word;
	});
	return changed ? { text: tokens.join(' '), score: lowest } : null;
}

function match(rules: ReadonlyArray<Rule<Intent>>, text: string): { intent: Intent; slots: Record<string, string> } | null {
	for (const { intent, pattern, slots: toSlots } of rules) {
		const found = pattern.exec(text);
		if (!found) continue;
		const groups = found.groups ?? {};
		if (toSlots) {
			const slots = toSlots(groups);
			if (slots) return { intent, slots };
			continue;
		}
		const slots: Record<string, string> = {};
		for (const [name, value] of Object.entries(groups)) if (value) slots[name] = value;
		return { intent, slots };
	}
	return null;
}

/**
 * Returns null when nothing is confident enough to act on. A quiet assistant that occasionally
 * misses is better than a chatty one that misfires, so sub-threshold input is discarded
 * silently rather than answered with "sorry, I didn't catch that".
 *
 * Passes run strictest first, so anything the plain grammar matches is never second-guessed by
 * a recovery pass.
 */
export function parse(transcript: string): ParsedIntent | null {
	const normalised = normalise(transcript);
	if (!normalised) return null;

	const exact = match(FULL_GRAMMAR, normalised);
	if (exact) return { ...exact, confidence: GRAMMAR_CONFIDENCE, normalised };

	const stripped = stripFiller(normalised);
	if (!stripped) return null;
	const polite = stripped === normalised ? null : match(FULL_GRAMMAR, stripped);
	if (polite) return { ...polite, confidence: GRAMMAR_CONFIDENCE, normalised: stripped };

	// A repaired keyword is a guess, so it is capped at fuzzy confidence and the ack names
	// what was acted on.
	const corrected = correctKeywords(stripped);
	const repaired = corrected ? match(ASSISTANT_GRAMMAR, corrected.text) : null;
	if (corrected && repaired)
		return {
			...repaired,
			confidence: Math.min(FUZZY_CEILING, corrected.score),
			normalised: corrected.text
		};

	// Fuzzy fallback on the leading token only. `play` is excluded: its slot is greedy, so a
	// near-miss there would swallow an entire unrelated sentence as a search query.
	const first = stripped.split(' ')[0];
	if (!first) return null;

	let best: { intent: Intent; score: number } | null = null;
	for (const { word, intent } of FUZZY_VERBS) {
		const score = similarity(first, word);
		if (!best || score > best.score) best = { intent, score };
	}
	if (!best || best.score < 0.6) return null;

	const confidence = Math.min(FUZZY_CEILING, best.score);
	if (confidence < FUZZY_FLOOR) return null;
	return { intent: best.intent, slots: {}, confidence, normalised: stripped };
}
