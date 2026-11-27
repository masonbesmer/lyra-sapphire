import { db } from './database';

/**
 * Anti-raid and the verification gate (LYRA-12): the config, the join-rate tracker and the rules
 * that decide what happens to a new member. Nothing here talks to Discord; the listener and the
 * actions live in src/lib/antiRaidActions.ts.
 *
 * Everything that reacts to joins needs the Server Members privileged intent, which Lyra only
 * requests when DISCORD_MEMBERS_INTENT is set (see membersIntentEnabled). The verification
 * button works without it.
 */

export const JOIN_ACTIONS = ['none', 'quarantine', 'kick', 'ban'] as const;
export type JoinAction = (typeof JOIN_ACTIONS)[number];

export const VERIFY_MODES = ['button', 'captcha'] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];

export function isJoinAction(value: string): value is JoinAction {
	return (JOIN_ACTIONS as readonly string[]).includes(value);
}

/** Past tense, for alerts: "quarantined @x on join". */
export function formatJoinAction(action: JoinAction): string {
	return { none: 'let in', quarantine: 'quarantined', kick: 'kicked', ban: 'banned' }[action];
}

export function isVerifyMode(value: string): value is VerifyMode {
	return (VERIFY_MODES as readonly string[]).includes(value);
}

export { membersIntentEnabled } from './gatewayIntents';

export interface AntiRaidConfig {
	guild_id: string;
	enabled: boolean;
	join_threshold: number;
	join_window_ms: number;
	raid_lockdown: boolean;
	raid_join_action: JoinAction;
	raid_duration_ms: number;
	alert_channel_id: string | null;
	alert_role_id: string | null;
	min_account_age_ms: number;
	account_age_action: JoinAction;
	default_avatar_action: JoinAction;
	quarantine_role_id: string | null;
	quarantine_on_join: boolean;
	verify_role_id: string | null;
	verify_mode: VerifyMode;
	raid_until: string | null;
	raid_locked: boolean;
	raid_join_count: number;
}

interface AntiRaidRow extends Omit<AntiRaidConfig, 'enabled' | 'raid_lockdown' | 'quarantine_on_join' | 'raid_locked'> {
	enabled: number;
	raid_lockdown: number;
	quarantine_on_join: number;
	raid_locked: number;
}

export const DEFAULT_ANTIRAID: Omit<AntiRaidConfig, 'guild_id'> = {
	enabled: false,
	join_threshold: 10,
	join_window_ms: 10_000,
	raid_lockdown: true,
	raid_join_action: 'quarantine',
	raid_duration_ms: 15 * 60_000,
	alert_channel_id: null,
	alert_role_id: null,
	min_account_age_ms: 0,
	account_age_action: 'quarantine',
	default_avatar_action: 'none',
	quarantine_role_id: null,
	quarantine_on_join: false,
	verify_role_id: null,
	verify_mode: 'button',
	raid_until: null,
	raid_locked: false,
	raid_join_count: 0
};

/** Bounds for the settings, so a typo can't make every single join a "raid". */
export const LIMITS = {
	joinThreshold: { min: 3, max: 100 },
	joinWindowMs: { min: 5_000, max: 10 * 60_000 },
	raidDurationMs: { min: 60_000, max: 24 * 60 * 60_000 },
	minAccountAgeMs: { min: 0, max: 365 * 24 * 60 * 60_000 }
} as const;

export function getAntiRaidConfig(guildId: string): AntiRaidConfig {
	const row = db.prepare(`SELECT * FROM antiraid_config WHERE guild_id = ?`).get(guildId) as AntiRaidRow | undefined;
	if (!row) return { guild_id: guildId, ...DEFAULT_ANTIRAID };
	return {
		...row,
		guild_id: guildId,
		enabled: row.enabled === 1,
		raid_lockdown: row.raid_lockdown === 1,
		quarantine_on_join: row.quarantine_on_join === 1,
		raid_locked: row.raid_locked === 1,
		raid_join_action: isJoinAction(row.raid_join_action) ? row.raid_join_action : DEFAULT_ANTIRAID.raid_join_action,
		account_age_action: isJoinAction(row.account_age_action) ? row.account_age_action : DEFAULT_ANTIRAID.account_age_action,
		default_avatar_action: isJoinAction(row.default_avatar_action) ? row.default_avatar_action : DEFAULT_ANTIRAID.default_avatar_action,
		verify_mode: isVerifyMode(row.verify_mode) ? row.verify_mode : DEFAULT_ANTIRAID.verify_mode
	};
}

/** The settings /antiraid set can change. Raid state (raid_until etc.) has its own setters. */
export type AntiRaidSettings = Partial<
	Pick<
		AntiRaidConfig,
		| 'enabled'
		| 'join_threshold'
		| 'join_window_ms'
		| 'raid_lockdown'
		| 'raid_join_action'
		| 'raid_duration_ms'
		| 'alert_channel_id'
		| 'alert_role_id'
		| 'min_account_age_ms'
		| 'account_age_action'
		| 'default_avatar_action'
		| 'quarantine_role_id'
		| 'quarantine_on_join'
		| 'verify_role_id'
		| 'verify_mode'
	>
>;

const SETTING_COLUMNS: readonly (keyof AntiRaidSettings)[] = [
	'enabled',
	'join_threshold',
	'join_window_ms',
	'raid_lockdown',
	'raid_join_action',
	'raid_duration_ms',
	'alert_channel_id',
	'alert_role_id',
	'min_account_age_ms',
	'account_age_action',
	'default_avatar_action',
	'quarantine_role_id',
	'quarantine_on_join',
	'verify_role_id',
	'verify_mode'
];

function toColumn(value: unknown): unknown {
	return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

export function updateAntiRaidConfig(guildId: string, settings: AntiRaidSettings): AntiRaidConfig {
	const entries = Object.entries(settings).filter(([key, value]) => value !== undefined && SETTING_COLUMNS.includes(key as keyof AntiRaidSettings));
	db.prepare(`INSERT OR IGNORE INTO antiraid_config (guild_id) VALUES (?)`).run(guildId);
	if (entries.length) {
		const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
		db.prepare(`UPDATE antiraid_config SET ${assignments} WHERE guild_id = ?`).run(...entries.map(([, value]) => toColumn(value)), guildId);
	}
	return getAntiRaidConfig(guildId);
}

/** Problems with a set of settings before they are saved (out of range, nothing to quarantine with). */
export function validateSettings(next: AntiRaidConfig): string | null {
	const { joinThreshold, joinWindowMs, raidDurationMs, minAccountAgeMs } = LIMITS;
	if (next.join_threshold < joinThreshold.min || next.join_threshold > joinThreshold.max) {
		return `join threshold has to be between ${joinThreshold.min} and ${joinThreshold.max}.`;
	}
	if (next.join_window_ms < joinWindowMs.min || next.join_window_ms > joinWindowMs.max) return 'the join window has to be between 5s and 10m.';
	if (next.raid_duration_ms < raidDurationMs.min || next.raid_duration_ms > raidDurationMs.max) return 'raid mode has to last between 1m and 24h.';
	if (next.min_account_age_ms < minAccountAgeMs.min || next.min_account_age_ms > minAccountAgeMs.max) {
		return 'minimum account age has to be 1 year or less.';
	}
	const quarantines =
		next.quarantine_on_join ||
		next.raid_join_action === 'quarantine' ||
		(next.min_account_age_ms > 0 && next.account_age_action === 'quarantine') ||
		next.default_avatar_action === 'quarantine';
	if (quarantines && !next.quarantine_role_id) return 'set a quarantine role first, or pick kick/ban/none for those checks.';
	return null;
}

export function startRaid(guildId: string, until: Date, locked: boolean): void {
	db.prepare(`INSERT OR IGNORE INTO antiraid_config (guild_id) VALUES (?)`).run(guildId);
	db.prepare(`UPDATE antiraid_config SET raid_until = ?, raid_locked = ?, raid_join_count = 0 WHERE guild_id = ?`).run(
		until.toISOString(),
		locked ? 1 : 0,
		guildId
	);
}

export function countRaidJoin(guildId: string): void {
	db.prepare(`UPDATE antiraid_config SET raid_join_count = raid_join_count + 1 WHERE guild_id = ?`).run(guildId);
}

/** Ends raid mode and returns what it was, or null if it wasn't on. */
export function endRaid(guildId: string): { locked: boolean; joins: number } | null {
	const config = getAntiRaidConfig(guildId);
	if (!config.raid_until) return null;
	db.prepare(`UPDATE antiraid_config SET raid_until = NULL, raid_locked = 0, raid_join_count = 0 WHERE guild_id = ?`).run(guildId);
	return { locked: config.raid_locked, joins: config.raid_join_count };
}

export function isRaidActive(config: Pick<AntiRaidConfig, 'raid_until'>, now = new Date()): boolean {
	return config.raid_until !== null && new Date(config.raid_until).getTime() > now.getTime();
}

/** Guilds whose raid mode has run out and should be wound down. */
export function expiredRaids(now = new Date()): string[] {
	return (
		db.prepare(`SELECT guild_id FROM antiraid_config WHERE raid_until IS NOT NULL AND raid_until <= ?`).all(now.toISOString()) as {
			guild_id: string;
		}[]
	).map((row) => row.guild_id);
}

// ---------------------------------------------------------------------------------------------
// Join rate
// ---------------------------------------------------------------------------------------------

/**
 * Sliding-window join counter per guild. Memory only: after a restart the window starts empty,
 * which at worst delays detection by one window.
 */
export class JoinRateTracker {
	private readonly joins = new Map<string, number[]>();

	/** Records a join and returns how many joins fall inside the window, this one included. */
	public record(guildId: string, windowMs: number, now = Date.now()): number {
		const recent = (this.joins.get(guildId) ?? []).filter((at) => now - at < windowMs);
		recent.push(now);
		this.joins.set(guildId, recent);
		return recent.length;
	}

	public reset(guildId: string): void {
		this.joins.delete(guildId);
	}
}

// ---------------------------------------------------------------------------------------------
// Screening a new member
// ---------------------------------------------------------------------------------------------

export interface JoinFacts {
	accountCreatedAt: number;
	hasDefaultAvatar: boolean;
	isBot: boolean;
}

export interface JoinVerdict {
	action: JoinAction;
	reason: string | null;
}

const SEVERITY: Record<JoinAction, number> = { none: 0, quarantine: 1, kick: 2, ban: 3 };

/**
 * What to do with a new member. Every check that applies is weighed and the harshest action
 * wins, so "kick young accounts" beats "quarantine everyone". Bots are left alone: only someone
 * with Manage Server can add one.
 */
export function screenJoin(config: AntiRaidConfig, facts: JoinFacts, now = Date.now()): JoinVerdict {
	if (!config.enabled || facts.isBot) return { action: 'none', reason: null };
	const candidates: JoinVerdict[] = [];
	if (isRaidActive(config, new Date(now)) && config.raid_join_action !== 'none') {
		candidates.push({ action: config.raid_join_action, reason: 'joined during raid mode' });
	}
	if (config.min_account_age_ms > 0 && now - facts.accountCreatedAt < config.min_account_age_ms && config.account_age_action !== 'none') {
		candidates.push({ action: config.account_age_action, reason: 'account is too new' });
	}
	if (facts.hasDefaultAvatar && config.default_avatar_action !== 'none') {
		candidates.push({ action: config.default_avatar_action, reason: 'no profile picture' });
	}
	if (config.quarantine_on_join) candidates.push({ action: 'quarantine', reason: 'new members wait for verification' });
	if (!candidates.length) return { action: 'none', reason: null };
	return candidates.reduce((worst, next) => (SEVERITY[next.action] > SEVERITY[worst.action] ? next : worst));
}

// ---------------------------------------------------------------------------------------------
// Captcha
// ---------------------------------------------------------------------------------------------

/** No 0/O, 1/I/L: the code is read off a screen and typed back. */
const CAPTCHA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CAPTCHA_TTL_MS = 5 * 60_000;

export function makeCaptchaCode(random: () => number = Math.random, length = 5): string {
	let code = '';
	for (let i = 0; i < length; i++) code += CAPTCHA_ALPHABET[Math.floor(random() * CAPTCHA_ALPHABET.length)];
	return code;
}

/** Spaced out with a zero-width joiner between letters, so it can't simply be copy-pasted back. */
export function displayCaptcha(code: string): string {
	return code.split('').join('‍ ');
}

/** Pending captcha codes per guild member. Memory only; a restart just means asking for a new code. */
export class CaptchaStore {
	private readonly codes = new Map<string, { code: string; expires: number }>();

	public issue(guildId: string, userId: string, code: string, now = Date.now()): void {
		this.codes.set(`${guildId}:${userId}`, { code, expires: now + CAPTCHA_TTL_MS });
	}

	/** Checks an answer. A code is good for one try, right or wrong. */
	public check(guildId: string, userId: string, answer: string, now = Date.now()): 'ok' | 'wrong' | 'expired' {
		const key = `${guildId}:${userId}`;
		const entry = this.codes.get(key);
		this.codes.delete(key);
		if (!entry || entry.expires < now) return 'expired';
		return answer.trim().toUpperCase().replace(/\s+/g, '') === entry.code ? 'ok' : 'wrong';
	}
}
