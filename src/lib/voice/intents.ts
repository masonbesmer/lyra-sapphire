/**
 * Grammar-first intent parsing.
 *
 * Whisper on a 1–3 second command is accurate enough that a hand-written grammar beats an
 * NLU model here, and it is debuggable: when a command is misread you can see exactly which
 * pattern did or did not match.
 */

export type Intent = 'play' | 'skip' | 'pause' | 'resume' | 'stop' | 'volume_set' | 'volume_rel' | 'nowplaying' | 'queue' | 'shuffle' | 'disconnect';

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

/** Ordered: first match wins. */
const GRAMMAR: Array<{ intent: Intent; pattern: RegExp }> = [
	{ intent: 'play', pattern: /^(?:play|put on|queue up)\s+(?<query>.+)$/ },
	// Allows the natural two-word tails people actually say — "skip this track", "skip the song".
	{ intent: 'skip', pattern: /^(?:skip|next)(?: (?:this|the|it))?(?: (?:one|song|track))?$/ },
	{ intent: 'pause', pattern: /^(?:pause|hold on|wait)$/ },
	{ intent: 'resume', pattern: /^(?:resume|unpause|continue|keep going)$/ },
	{ intent: 'stop', pattern: /^(?:stop playing|stop|shut up)$/ },
	{ intent: 'volume_set', pattern: /^(?:set )?volume(?: to)? (?<n>\d{1,3})$/ },
	{ intent: 'volume_rel', pattern: /^(?:turn it |volume )?(?<dir>up|down|louder|quieter)$/ },
	{ intent: 'nowplaying', pattern: /^(?:what(?:'s| is) (?:this|playing)|now playing)$/ },
	{ intent: 'queue', pattern: /^(?:what's (?:in the )?queue|show queue|queue)$/ },
	{ intent: 'shuffle', pattern: /^shuffle(?: the queue)?$/ },
	{ intent: 'disconnect', pattern: /^(?:leave|disconnect|get out)$/ }
];

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

/**
 * Returns null when nothing is confident enough to act on. A quiet assistant that occasionally
 * misses is better than a chatty one that misfires, so sub-threshold input is discarded
 * silently rather than answered with "sorry, I didn't catch that".
 */
export function parse(transcript: string): ParsedIntent | null {
	const normalised = normalise(transcript);
	if (!normalised) return null;

	for (const { intent, pattern } of GRAMMAR) {
		const match = pattern.exec(normalised);
		if (!match) continue;
		const slots: Record<string, string> = {};
		for (const [name, value] of Object.entries(match.groups ?? {})) if (value) slots[name] = value;
		return { intent, slots, confidence: GRAMMAR_CONFIDENCE, normalised };
	}

	// Fuzzy fallback on the leading token only. `play` is excluded: its slot is greedy, so a
	// near-miss there would swallow an entire unrelated sentence as a search query.
	const first = normalised.split(' ')[0];
	if (!first) return null;

	let best: { intent: Intent; score: number } | null = null;
	for (const { word, intent } of FUZZY_VERBS) {
		const score = 1 - levenshtein(first, word) / Math.max(first.length, word.length);
		if (!best || score > best.score) best = { intent, score };
	}
	if (!best || best.score < 0.6) return null;

	const confidence = Math.min(FUZZY_CEILING, best.score);
	if (confidence < FUZZY_FLOOR) return null;
	return { intent: best.intent, slots: {}, confidence, normalised };
}
