import { db } from './database';
import { isPhishingHost } from './phishing';

/**
 * AutoMod (LYRA-11): the filters and their per-guild settings. Everything here works on plain
 * data so it can be tested without discord.js; src/lib/automodActions.ts feeds it real messages
 * and applies the result.
 */

export const AUTOMOD_RULES = [
	'phishing',
	'words',
	'invites',
	'links',
	'attachments',
	'mentions',
	'zalgo',
	'caps',
	'emoji',
	'duplicates',
	'flood'
] as const;
export type AutomodRule = (typeof AUTOMOD_RULES)[number];

export function isAutomodRule(value: string): value is AutomodRule {
	return (AUTOMOD_RULES as readonly string[]).includes(value);
}

/** Least to most severe. `log` posts to the mod log and leaves the message alone. */
export const AUTOMOD_ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban'] as const;
export type AutomodAction = (typeof AUTOMOD_ACTIONS)[number];

export function isAutomodAction(value: string): value is AutomodAction {
	return (AUTOMOD_ACTIONS as readonly string[]).includes(value);
}

export const RULE_DESCRIPTIONS: Record<AutomodRule, string> = {
	phishing: 'Known phishing/scam domains and Discord/Steam lookalikes',
	words: 'Banned words and /regex/ patterns',
	invites: 'Discord invite links (except allowed codes)',
	links: 'Links, by domain allow- or blocklist',
	attachments: 'Blocked attachment file types',
	mentions: 'Too many mentions in one message',
	zalgo: 'Zalgo / stacked combining characters',
	caps: 'Mostly capital letters',
	emoji: 'Too many emoji in one message',
	duplicates: 'The same message posted repeatedly',
	flood: 'Too many messages too fast'
};

/** Rules that only look at a message's content, so they also run on edits. */
export const CONTENT_RULES: readonly AutomodRule[] = ['phishing', 'words', 'invites', 'links', 'mentions', 'zalgo', 'caps', 'emoji'];

export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const MAX_LIST_ENTRIES = 500;
export const MAX_PATTERN_LENGTH = 200;

export interface RuleSettings {
	/** words: plain words (`*` wildcards) and `/regex/` patterns. */
	words?: string[];
	/** invites: invite codes that are allowed. */
	allow?: string[];
	/** links: `block` blocks the listed domains, `allow` blocks every other domain. */
	mode?: 'block' | 'allow';
	/** links: domains; phishing: extra domains on top of the shared list. */
	domains?: string[];
	/** attachments: blocked extensions, without the dot. */
	extensions?: string[];
	/** mentions/emoji: max per message; caps: percent; zalgo: max combining marks in a row; duplicates/flood: messages. */
	limit?: number;
	/** duplicates/flood: the window the limit applies to. */
	windowMs?: number;
}

export interface RuleConfig {
	rule: AutomodRule;
	enabled: boolean;
	action: AutomodAction;
	/** Timeout length, or temp-ban length (null = permanent). */
	durationMs: number | null;
	settings: RuleSettings;
	exemptRoles: string[];
	exemptChannels: string[];
}

export interface AutomodSettings {
	nativeSync: boolean;
	exemptRoles: string[];
	exemptChannels: string[];
}

export const DEFAULT_BLOCKED_EXTENSIONS = [
	'exe',
	'scr',
	'bat',
	'cmd',
	'com',
	'msi',
	'pif',
	'vbs',
	'vbe',
	'js',
	'jse',
	'wsf',
	'ps1',
	'jar',
	'apk',
	'lnk',
	'hta',
	'cpl',
	'dll'
];

/** Defaults a filter starts with, so turning one on does something sensible straight away. */
export const RULE_DEFAULTS: Record<AutomodRule, RuleSettings> = {
	phishing: { domains: [] },
	words: { words: [] },
	invites: { allow: [] },
	links: { mode: 'block', domains: [] },
	attachments: { extensions: DEFAULT_BLOCKED_EXTENSIONS },
	mentions: { limit: 5 },
	zalgo: { limit: 5 },
	caps: { limit: 70 },
	emoji: { limit: 10 },
	duplicates: { limit: 3, windowMs: 30_000 },
	flood: { limit: 6, windowMs: 5_000 }
};

/** Phishing is the one filter that defaults to something stronger than delete. */
const DEFAULT_ACTION: Partial<Record<AutomodRule, AutomodAction>> = { phishing: 'ban' };

/** Which limit/window a rule understands, for help text and validation. */
export const RULE_LIMITS: Partial<Record<AutomodRule, { limit: [number, number]; window?: [number, number]; label: string }>> = {
	mentions: { limit: [1, 50], label: 'mentions per message' },
	zalgo: { limit: [2, 50], label: 'combining marks in a row' },
	caps: { limit: [30, 100], label: '% capitals (messages of 10+ letters)' },
	emoji: { limit: [1, 100], label: 'emoji per message' },
	duplicates: { limit: [2, 20], window: [5_000, 600_000], label: 'identical messages' },
	flood: { limit: [2, 50], window: [1_000, 120_000], label: 'messages' }
};

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

interface RuleRow {
	rule: string;
	enabled: number;
	action: string;
	duration_ms: number | null;
	settings: string;
	exempt_roles: string;
	exempt_channels: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function defaultRule(rule: AutomodRule): RuleConfig {
	return {
		rule,
		enabled: false,
		action: DEFAULT_ACTION[rule] ?? 'delete',
		durationMs: null,
		settings: structuredClone(RULE_DEFAULTS[rule]),
		exemptRoles: [],
		exemptChannels: []
	};
}

function fromRow(rule: AutomodRule, row: RuleRow | undefined): RuleConfig {
	if (!row) return defaultRule(rule);
	return {
		rule,
		enabled: row.enabled === 1,
		action: isAutomodAction(row.action) ? row.action : 'delete',
		durationMs: row.duration_ms,
		settings: { ...structuredClone(RULE_DEFAULTS[rule]), ...parseJson<RuleSettings>(row.settings, {}) },
		exemptRoles: stringArray(parseJson(row.exempt_roles, [])),
		exemptChannels: stringArray(parseJson(row.exempt_channels, []))
	};
}

export function getRule(guildId: string, rule: AutomodRule): RuleConfig {
	const row = db.prepare(`SELECT * FROM automod_rules WHERE guild_id = ? AND rule = ?`).get(guildId, rule) as RuleRow | undefined;
	return fromRow(rule, row);
}

export function getRules(guildId: string): RuleConfig[] {
	const rows = db.prepare(`SELECT * FROM automod_rules WHERE guild_id = ?`).all(guildId) as RuleRow[];
	const byRule = new Map(rows.map((row) => [row.rule, row]));
	return AUTOMOD_RULES.map((rule) => fromRow(rule, byRule.get(rule)));
}

/** Only the guild's enabled rules; the hot path for every message. */
export function getEnabledRules(guildId: string): RuleConfig[] {
	const rows = db.prepare(`SELECT * FROM automod_rules WHERE guild_id = ? AND enabled = 1`).all(guildId) as RuleRow[];
	return rows.filter((row) => isAutomodRule(row.rule)).map((row) => fromRow(row.rule as AutomodRule, row));
}

export function saveRule(guildId: string, config: RuleConfig): void {
	db.prepare(
		`INSERT INTO automod_rules (guild_id, rule, enabled, action, duration_ms, settings, exempt_roles, exempt_channels)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(guild_id, rule) DO UPDATE SET enabled = excluded.enabled, action = excluded.action, duration_ms = excluded.duration_ms,
			settings = excluded.settings, exempt_roles = excluded.exempt_roles, exempt_channels = excluded.exempt_channels`
	).run(
		guildId,
		config.rule,
		config.enabled ? 1 : 0,
		config.action,
		config.durationMs,
		JSON.stringify(config.settings),
		JSON.stringify(config.exemptRoles),
		JSON.stringify(config.exemptChannels)
	);
}

/** Read-modify-write of one rule. Returns the rule as stored. */
export function updateRule(guildId: string, rule: AutomodRule, change: (config: RuleConfig) => void): RuleConfig {
	const config = getRule(guildId, rule);
	change(config);
	saveRule(guildId, config);
	return config;
}

export function getAutomodSettings(guildId: string): AutomodSettings {
	const row = db.prepare(`SELECT native_sync, exempt_roles, exempt_channels FROM automod_settings WHERE guild_id = ?`).get(guildId) as
		{ native_sync: number; exempt_roles: string; exempt_channels: string } | undefined;
	return {
		nativeSync: row?.native_sync === 1,
		exemptRoles: stringArray(parseJson(row?.exempt_roles, [])),
		exemptChannels: stringArray(parseJson(row?.exempt_channels, []))
	};
}

export function saveAutomodSettings(guildId: string, settings: AutomodSettings): void {
	db.prepare(
		`INSERT INTO automod_settings (guild_id, native_sync, exempt_roles, exempt_channels) VALUES (?, ?, ?, ?)
		ON CONFLICT(guild_id) DO UPDATE SET native_sync = excluded.native_sync, exempt_roles = excluded.exempt_roles,
			exempt_channels = excluded.exempt_channels`
	).run(guildId, settings.nativeSync ? 1 : 0, JSON.stringify(settings.exemptRoles), JSON.stringify(settings.exemptChannels));
}

// ---------------------------------------------------------------------------------------------
// List entries
// ---------------------------------------------------------------------------------------------

/** The settings key a rule's list lives under, for the rules that have one. */
export const RULE_LIST_KEY: Partial<Record<AutomodRule, 'words' | 'allow' | 'domains' | 'extensions'>> = {
	words: 'words',
	invites: 'allow',
	links: 'domains',
	phishing: 'domains',
	attachments: 'extensions'
};

/** Normalises a list entry for its rule, or returns an error message. */
export function normaliseListEntry(rule: AutomodRule, raw: string): { value: string } | { error: string } {
	const text = raw.trim();
	if (!text) return { error: 'that entry is empty.' };
	if (rule === 'words') {
		if (text.length > MAX_PATTERN_LENGTH) return { error: `entries are limited to ${MAX_PATTERN_LENGTH} characters.` };
		const regex = parseRegexEntry(text);
		if (regex === null) return { value: text.toLowerCase() };
		if (regex instanceof Error) return { error: `that regex doesn't compile: ${regex.message}` };
		return { value: text };
	}
	if (rule === 'invites') {
		const code = inviteCode(text) ?? (/^[\w-]{2,32}$/.test(text) ? text : null);
		return code ? { value: code } : { error: "that isn't an invite link or code." };
	}
	if (rule === 'attachments') {
		const ext = text.replace(/^\*?\./, '').toLowerCase();
		return /^[a-z0-9]{1,10}$/.test(ext) ? { value: ext } : { error: "that isn't a file extension (e.g. `exe`)." };
	}
	// links / phishing: a domain.
	const host = hostFromText(text);
	return host ? { value: host } : { error: "that isn't a domain (e.g. `example.com`)." };
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Patterns like `(a+)+` can take exponential time on a crafted message; refuse them. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,?\d*\})/;

/** `/pattern/` → a RegExp (case-insensitive), an Error if it's a bad regex, or null if it's a plain word. */
export function parseRegexEntry(entry: string): RegExp | Error | null {
	const match = entry.match(/^\/(.+)\/$/s);
	if (!match) return null;
	if (NESTED_QUANTIFIER.test(match[1])) return new Error('nested repetition like `(a+)+` is not allowed');
	try {
		return new RegExp(match[1], 'iu');
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_CHAR = '[\\p{L}\\p{N}_]';

/**
 * A plain entry matches as a whole word, case-insensitively. `*` is a wildcard for letters, so
 * `scam*` also catches "scammer" and `*coin` catches "shitcoin", like Discord's own keyword filter.
 */
export function wordPattern(entry: string): RegExp {
	const body = entry
		.split('*')
		.map((part) => escapeRegex(part))
		.join(`${WORD_CHAR}*`);
	return new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, 'iu');
}

const compiled = new Map<string, RegExp | null>();

function compileEntry(entry: string): RegExp | null {
	let pattern = compiled.get(entry);
	if (pattern === undefined) {
		const regex = parseRegexEntry(entry);
		pattern = regex === null ? wordPattern(entry) : regex instanceof Error ? null : regex;
		if (compiled.size > 5000) compiled.clear();
		compiled.set(entry, pattern);
	}
	return pattern;
}

export function findBannedWord(content: string, entries: readonly string[]): string | null {
	for (const entry of entries) {
		const pattern = compileEntry(entry);
		if (pattern?.test(content)) return entry;
	}
	return null;
}

const INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/([\w-]{2,32})/gi;

export function inviteCode(text: string): string | null {
	INVITE_PATTERN.lastIndex = 0;
	const match = INVITE_PATTERN.exec(text);
	return match ? match[1] : null;
}

export function findInvites(content: string): string[] {
	return [...content.matchAll(INVITE_PATTERN)].map((match) => match[1]);
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

export function hostFromText(text: string): string | null {
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
	try {
		const host = new URL(candidate).hostname
			.toLowerCase()
			.replace(/^www\./, '')
			.replace(/\.$/, '');
		return host.includes('.') && /^[a-z0-9.-]+$/.test(host) ? host : null;
	} catch {
		return null;
	}
}

/** Hostnames of every link in a message (lowercase, without `www.`). */
export function extractHosts(content: string): string[] {
	const hosts = new Set<string>();
	for (const match of content.matchAll(URL_PATTERN)) {
		const host = hostFromText(match[0]);
		if (host) hosts.add(host);
	}
	return [...hosts];
}

/** `a.b.example.com` matches a listed `example.com`. */
export function hostMatches(host: string, domains: readonly string[]): string | null {
	for (const domain of domains) {
		if (host === domain || host.endsWith(`.${domain}`)) return domain;
	}
	return null;
}

const CUSTOM_EMOJI = /<a?:\w{2,32}:\d{17,20}>/g;
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;

export function countEmoji(content: string): number {
	const custom = content.match(CUSTOM_EMOJI)?.length ?? 0;
	const unicode = content.replace(CUSTOM_EMOJI, '').match(UNICODE_EMOJI)?.length ?? 0;
	return custom + unicode;
}

/** Share of capital letters among all cased letters, 0–100. Mentions, emoji and links don't count. */
export function capsPercent(content: string): { percent: number; letters: number } {
	const text = content.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, '');
	let upper = 0;
	let letters = 0;
	for (const char of text) {
		const lower = char.toLowerCase();
		const up = char.toUpperCase();
		if (lower === up) continue;
		letters++;
		if (char === up) upper++;
	}
	return { percent: letters ? Math.round((upper / letters) * 100) : 0, letters };
}

/** Minimum cased letters before the caps filter looks at a message ("OK" and "LOL" are fine). */
export const CAPS_MIN_LETTERS = 10;

/** Longest run of combining marks attached to one character. */
export function longestCombiningRun(content: string): number {
	let longest = 0;
	for (const match of content.matchAll(/\p{M}+/gu)) longest = Math.max(longest, [...match[0]].length);
	return longest;
}

export function fileExtension(name: string): string | null {
	const match = name.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
	return match ? match[1] : null;
}

/** What a filter sees of a message. */
export interface AutomodMessage {
	content: string;
	/** Distinct users + roles mentioned, plus 1 for @everyone/@here. */
	mentionCount: number;
	attachmentNames: string[];
}

export interface Violation {
	rule: AutomodRule;
	/** Short reason for the mod log and the member, e.g. `banned word "scam*"`. */
	detail: string;
}

/** Runs one content filter. Rate filters (duplicates, flood) are handled by SpamTracker. */
export function checkContentRule(config: RuleConfig, message: AutomodMessage): Violation | null {
	const { rule, settings } = config;
	const limit = settings.limit ?? RULE_DEFAULTS[rule].limit ?? 0;
	const hit = (detail: string): Violation => ({ rule, detail });
	switch (rule) {
		case 'phishing': {
			for (const host of extractHosts(message.content)) {
				if (hostMatches(host, settings.domains ?? []) || isPhishingHost(host)) return hit(`phishing link (${host})`);
			}
			return null;
		}
		case 'words': {
			const word = findBannedWord(message.content, settings.words ?? []);
			return word ? hit(`banned word \`${word}\``) : null;
		}
		case 'invites': {
			const allowed = new Set((settings.allow ?? []).map((code) => code.toLowerCase()));
			const code = findInvites(message.content).find((entry) => !allowed.has(entry.toLowerCase()));
			return code ? hit(`invite link (${code})`) : null;
		}
		case 'links': {
			const domains = settings.domains ?? [];
			for (const host of extractHosts(message.content)) {
				const listed = hostMatches(host, domains);
				if (settings.mode === 'allow' ? !listed : listed) return hit(`link to ${host}`);
			}
			return null;
		}
		case 'attachments': {
			const blocked = new Set(settings.extensions ?? []);
			const file = message.attachmentNames.find((name) => {
				const ext = fileExtension(name);
				return ext !== null && blocked.has(ext);
			});
			return file ? hit(`blocked file type (${file})`) : null;
		}
		case 'mentions':
			return message.mentionCount > limit ? hit(`${message.mentionCount} mentions (limit ${limit})`) : null;
		case 'zalgo': {
			const run = longestCombiningRun(message.content);
			return run >= limit ? hit('zalgo text') : null;
		}
		case 'caps': {
			const { percent, letters } = capsPercent(message.content);
			return letters >= CAPS_MIN_LETTERS && percent >= limit ? hit(`${percent}% capitals`) : null;
		}
		case 'emoji': {
			const count = countEmoji(message.content);
			return count > limit ? hit(`${count} emoji (limit ${limit})`) : null;
		}
		default:
			return null;
	}
}

export interface Exemptions {
	roleIds: readonly string[];
	channelId: string;
	/** A thread's parent: exempting a channel covers its threads. */
	parentChannelId: string | null;
}

export function isExempt(lists: { exemptRoles: string[]; exemptChannels: string[] }, who: Exemptions): boolean {
	if (lists.exemptChannels.includes(who.channelId)) return true;
	if (who.parentChannelId && lists.exemptChannels.includes(who.parentChannelId)) return true;
	return who.roleIds.some((role) => lists.exemptRoles.includes(role));
}

export function actionSeverity(action: AutomodAction): number {
	return AUTOMOD_ACTIONS.indexOf(action);
}

/** Of several violations, the one whose rule has the harshest action (first rule wins a tie). */
export function pickWorst<T extends { config: RuleConfig }>(hits: readonly T[]): T | null {
	let worst: T | null = null;
	for (const entry of hits) {
		if (!worst || actionSeverity(entry.config.action) > actionSeverity(worst.config.action)) worst = entry;
	}
	return worst;
}

// ---------------------------------------------------------------------------------------------
// Rate filters
// ---------------------------------------------------------------------------------------------

export interface TrackedMessage {
	id: string;
	channelId: string;
	at: number;
	/** Normalised content, for duplicate detection. Empty for attachment-only messages. */
	key: string;
}

/** Lower-case, collapsed whitespace: "Buy NOW" and "buy  now" are duplicates. */
export function duplicateKey(content: string): string {
	return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Longest window any rate filter can use; older entries are dropped. */
const MAX_WINDOW_MS = 600_000;
const MAX_TRACKED = 60;

/**
 * Recent messages per guild member, for the duplicate and flood filters. In memory only: a
 * restart forgets the last few seconds of history, which is harmless.
 */
export class SpamTracker {
	private readonly recent = new Map<string, TrackedMessage[]>();

	public record(guildId: string, userId: string, message: TrackedMessage): TrackedMessage[] {
		const key = `${guildId}:${userId}`;
		const list = (this.recent.get(key) ?? []).filter((entry) => message.at - entry.at <= MAX_WINDOW_MS);
		list.push(message);
		if (list.length > MAX_TRACKED) list.splice(0, list.length - MAX_TRACKED);
		this.recent.set(key, list);
		return list;
	}

	/** Messages that tripped the filter (all of them, so the burst can be cleaned up), or null. */
	public check(rule: 'duplicates' | 'flood', settings: RuleSettings, history: readonly TrackedMessage[], now: number): TrackedMessage[] | null {
		const limit = settings.limit ?? RULE_DEFAULTS[rule].limit!;
		const windowMs = settings.windowMs ?? RULE_DEFAULTS[rule].windowMs!;
		const inWindow = history.filter((entry) => now - entry.at <= windowMs);
		if (rule === 'flood') return inWindow.length >= limit ? inWindow : null;
		const latest = history.at(-1);
		if (!latest?.key) return null;
		const same = inWindow.filter((entry) => entry.key === latest.key);
		return same.length >= limit ? same : null;
	}

	/** Forget a member's history, e.g. after acting on a burst so it isn't punished twice. */
	public reset(guildId: string, userId: string): void {
		this.recent.delete(`${guildId}:${userId}`);
	}

	/** Drop idle members; called now and then so the map doesn't grow forever. */
	public sweep(now: number): void {
		for (const [key, list] of this.recent) {
			if (!list.length || now - list[list.length - 1].at > MAX_WINDOW_MS) this.recent.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

export function describeRuleSettings(config: RuleConfig): string {
	const { rule, settings } = config;
	const limits = RULE_LIMITS[rule];
	const parts: string[] = [];
	if (limits) {
		parts.push(`${settings.limit} ${limits.label}`);
		if (limits.window && settings.windowMs) parts.push(`in ${Math.round(settings.windowMs / 1000)}s`);
	}
	const listKey = RULE_LIST_KEY[rule];
	if (listKey) {
		const list = (settings[listKey] as string[] | undefined) ?? [];
		if (rule === 'links') parts.push(`${settings.mode === 'allow' ? 'allowlist' : 'blocklist'}: ${list.length} domain(s)`);
		else if (rule === 'phishing') parts.push(`shared list + ${list.length} extra domain(s)`);
		else parts.push(`${list.length} ${rule === 'words' ? 'word(s)/pattern(s)' : rule === 'invites' ? 'allowed invite(s)' : 'extension(s)'}`);
	}
	return parts.join(', ');
}
