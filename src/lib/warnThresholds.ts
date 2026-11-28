import { db } from './database';
import { MAX_SCHEDULED_MS, MAX_TIMEOUT_MS, formatDuration } from './moderation';

/**
 * Warn thresholds (LYRA-11, B14): reaching N active warnings applies an action automatically,
 * e.g. 3 warns → 1 h timeout, 5 → kick. Warnings can expire so old ones stop counting; the case
 * itself stays in the record. The Discord side lives in src/lib/warnEscalation.ts.
 */

export const THRESHOLD_ACTIONS = ['timeout', 'kick', 'ban'] as const;
export type ThresholdAction = (typeof THRESHOLD_ACTIONS)[number];

export function isThresholdAction(value: string): value is ThresholdAction {
	return (THRESHOLD_ACTIONS as readonly string[]).includes(value);
}

export const MAX_THRESHOLDS = 10;
export const MAX_WARN_COUNT = 100;

export interface WarnThreshold {
	warn_count: number;
	action: ThresholdAction;
	/** Timeout length, or temp-ban length (null = permanent ban; ignored for kick). */
	duration_ms: number | null;
}

/** Why a threshold can't be stored as given, or null if it can. */
export function thresholdProblem(count: number, action: ThresholdAction, durationMs: number | null): string | null {
	if (!Number.isInteger(count) || count < 1 || count > MAX_WARN_COUNT) return `the warn count must be between 1 and ${MAX_WARN_COUNT}.`;
	if (action === 'timeout') {
		if (!durationMs) return 'a timeout threshold needs a duration (e.g. `1h`).';
		if (durationMs > MAX_TIMEOUT_MS) return 'Discord caps timeouts at 28 days.';
	}
	if (action === 'ban' && durationMs && durationMs > MAX_SCHEDULED_MS)
		return 'temp-bans are capped at a year; leave the duration out for a permanent ban.';
	return null;
}

export function getThresholds(guildId: string): WarnThreshold[] {
	return db
		.prepare(`SELECT warn_count, action, duration_ms FROM mod_warn_thresholds WHERE guild_id = ? ORDER BY warn_count`)
		.all(guildId) as WarnThreshold[];
}

export function setThreshold(guildId: string, count: number, action: ThresholdAction, durationMs: number | null): void {
	db.prepare(
		`INSERT INTO mod_warn_thresholds (guild_id, warn_count, action, duration_ms) VALUES (?, ?, ?, ?)
		ON CONFLICT(guild_id, warn_count) DO UPDATE SET action = excluded.action, duration_ms = excluded.duration_ms`
	).run(guildId, count, action, action === 'kick' ? null : durationMs);
}

export function removeThreshold(guildId: string, count: number): boolean {
	return db.prepare(`DELETE FROM mod_warn_thresholds WHERE guild_id = ? AND warn_count = ?`).run(guildId, count).changes > 0;
}

/** null: warnings never expire. */
export function getWarnExpiry(guildId: string): number | null {
	const row = db.prepare(`SELECT expiry_ms FROM mod_warn_config WHERE guild_id = ?`).get(guildId) as { expiry_ms: number | null } | undefined;
	return row?.expiry_ms ?? null;
}

export function setWarnExpiry(guildId: string, expiryMs: number | null): void {
	db.prepare(
		`INSERT INTO mod_warn_config (guild_id, expiry_ms) VALUES (?, ?)
		ON CONFLICT(guild_id) DO UPDATE SET expiry_ms = excluded.expiry_ms`
	).run(guildId, expiryMs);
}

/** Warn cases against the user that still count (not older than the guild's expiry). */
export function countActiveWarns(guildId: string, userId: string, now = new Date()): number {
	const expiry = getWarnExpiry(guildId);
	if (expiry === null) {
		return (
			db.prepare(`SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND target_id = ? AND action = 'warn'`).get(guildId, userId) as {
				n: number;
			}
		).n;
	}
	const cutoff = new Date(now.getTime() - expiry).toISOString();
	return (
		db
			.prepare(`SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND target_id = ? AND action = 'warn' AND created_at >= ?`)
			.get(guildId, userId, cutoff) as { n: number }
	).n;
}

/**
 * The threshold that fires at exactly this many active warnings. Exact, not "at least": with
 * 3 → timeout and 5 → kick, the 4th warn does nothing instead of timing them out again.
 */
export function thresholdFor(thresholds: readonly WarnThreshold[], activeWarns: number): WarnThreshold | null {
	return thresholds.find((entry) => entry.warn_count === activeWarns) ?? null;
}

export function describeThreshold(entry: WarnThreshold): string {
	if (entry.action === 'kick') return `${entry.warn_count} warns → kick`;
	if (entry.action === 'ban')
		return `${entry.warn_count} warns → ${entry.duration_ms ? `${formatDuration(entry.duration_ms)} ban` : 'permanent ban'}`;
	return `${entry.warn_count} warns → ${formatDuration(entry.duration_ms ?? 0)} timeout`;
}
