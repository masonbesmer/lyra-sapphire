import { db } from './database';

/**
 * Moderation data and the rules that don't need Discord: durations, role hierarchy, purge
 * filters, cases, notes, timed actions and per-guild config. The Discord side (DMs, the mod
 * log, applying actions) lives in src/lib/modActions.ts.
 */

export type ModAction =
	| 'warn'
	| 'timeout'
	| 'untimeout'
	| 'kick'
	| 'ban'
	| 'unban'
	| 'softban'
	| 'purge'
	| 'slowmode'
	| 'lock'
	| 'unlock'
	| 'nick'
	| 'role-add'
	| 'role-remove';

export type ModTargetType = 'user' | 'channel' | 'guild';

/** Actions whose target is a member who can still be DMed when the action lands. */
export const DM_ACTIONS = ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'softban'] as const satisfies readonly ModAction[];
export type DmAction = (typeof DM_ACTIONS)[number];

export function isDmAction(value: string): value is DmAction {
	return (DM_ACTIONS as readonly string[]).includes(value);
}

/** Discord's ceiling for a native timeout. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
/** Temp-bans and timed roles beyond a year are almost certainly a typo. */
export const MAX_SCHEDULED_MS = 365 * 24 * 60 * 60 * 1000;
/** Discord's slowmode ceiling (6 hours). */
export const MAX_SLOWMODE_SECONDS = 21_600;
/** Discord refuses to bulk-delete anything older than this. */
export const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** A reason longer than this would not fit an audit-log entry, so it's cut here instead. */
export const MAX_REASON_LENGTH = 512;

// ---------------------------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------------------------

const UNIT_MS: Record<string, number> = {
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000
};

const UNIT_ALIASES: Record<string, string> = {
	s: 's',
	sec: 's',
	secs: 's',
	second: 's',
	seconds: 's',
	m: 'm',
	min: 'm',
	mins: 'm',
	minute: 'm',
	minutes: 'm',
	h: 'h',
	hr: 'h',
	hrs: 'h',
	hour: 'h',
	hours: 'h',
	d: 'd',
	day: 'd',
	days: 'd',
	w: 'w',
	wk: 'w',
	wks: 'w',
	week: 'w',
	weeks: 'w'
};

/**
 * `10m`, `2d`, `1h30m`, `1w 2d`, `90s` → milliseconds. Returns null for anything that isn't
 * wholly a duration (a bare number is not one: `%ban @x 3 spam` must not read "3" as a time).
 */
export function parseDuration(input: string | null | undefined): number | null {
	if (!input) return null;
	const text = input.trim().toLowerCase().replace(/\s+/g, '');
	if (!text) return null;
	const pattern = /(\d+)([a-z]+)/g;
	let total = 0;
	let consumed = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index !== consumed) return null;
		const unit = UNIT_ALIASES[match[2]];
		if (!unit) return null;
		total += Number(match[1]) * UNIT_MS[unit];
		consumed += match[0].length;
	}
	if (consumed !== text.length || total <= 0 || !Number.isSafeInteger(total)) return null;
	return total;
}

/** 93_784_000 → `1d 2h 3m 4s`. Zero-valued parts are dropped. */
export function formatDuration(ms: number): string {
	if (ms <= 0) return '0s';
	const parts: string[] = [];
	let rest = Math.round(ms / 1000);
	for (const [unit, size] of [
		['w', 604_800],
		['d', 86_400],
		['h', 3_600],
		['m', 60],
		['s', 1]
	] as const) {
		const amount = Math.floor(rest / size);
		if (amount > 0) parts.push(`${amount}${unit}`);
		rest -= amount * size;
	}
	return parts.join(' ');
}

export function clampReason(reason: string | null | undefined): string | null {
	const trimmed = reason?.trim();
	if (!trimmed) return null;
	return trimmed.length > MAX_REASON_LENGTH ? `${trimmed.slice(0, MAX_REASON_LENGTH - 1)}…` : trimmed;
}

// ---------------------------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------------------------

export interface HierarchySubject {
	id: string;
	/** Position of the member's highest role. */
	highest: number;
}

export interface HierarchyInput {
	guildOwnerId: string;
	moderator: HierarchySubject;
	bot: HierarchySubject;
	/** null when the target isn't in the guild (e.g. banning by ID): nothing to compare. */
	target: HierarchySubject | null;
}

/**
 * Why the moderator may not act on the target, or null if they may. The guild owner outranks
 * everyone; otherwise both the moderator and the bot must sit strictly above the target.
 */
export function hierarchyProblem({ guildOwnerId, moderator, bot, target }: HierarchyInput): string | null {
	if (!target) return null;
	if (target.id === moderator.id) return "you can't use that on yourself.";
	if (target.id === bot.id) return "I'm not doing that to myself.";
	if (target.id === guildOwnerId) return "that's the server owner, nobody outranks them.";
	if (moderator.id !== guildOwnerId && target.highest >= moderator.highest) return 'their top role is equal to or above yours.';
	if (target.highest >= bot.highest) return 'their top role is equal to or above mine, so Discord won’t let me.';
	return null;
}

export interface RoleHierarchyInput {
	guildOwnerId: string;
	moderator: HierarchySubject;
	bot: HierarchySubject;
	role: { id: string; position: number; managed: boolean; guildId: string };
}

/** Why the moderator may not hand out or take away this role, or null if they may. */
export function roleProblem({ guildOwnerId, moderator, bot, role }: RoleHierarchyInput): string | null {
	if (role.id === role.guildId) return "that's @everyone, it can't be added or removed.";
	if (role.managed) return 'that role is managed by an integration, so nobody can assign it by hand.';
	if (moderator.id !== guildOwnerId && role.position >= moderator.highest) return 'that role is equal to or above your top role.';
	if (role.position >= bot.highest) return 'that role is equal to or above my top role, so Discord won’t let me.';
	return null;
}

// ---------------------------------------------------------------------------------------------
// Purge filters
// ---------------------------------------------------------------------------------------------

export interface PurgeFilter {
	userId?: string | null;
	bots?: boolean;
	links?: boolean;
	attachments?: boolean;
	embeds?: boolean;
	contains?: string | null;
}

/** The parts of a message a purge filter looks at, so the matcher can be tested without discord.js. */
export interface PurgeCandidate {
	authorId: string;
	authorBot: boolean;
	content: string;
	attachmentCount: number;
	embedCount: number;
	createdTimestamp: number;
	pinned: boolean;
}

const LINK_PATTERN = /https?:\/\/\S+|discord(?:\.gg|(?:app)?\.com\/invite)\/\S+/i;

/**
 * Every filter given must match (AND). Pinned messages are always kept, and anything Discord
 * can't bulk-delete (14 days or older) is skipped rather than failing the whole batch.
 */
export function matchesPurgeFilter(message: PurgeCandidate, filter: PurgeFilter, now = Date.now()): boolean {
	if (message.pinned) return false;
	if (now - message.createdTimestamp >= BULK_DELETE_MAX_AGE_MS) return false;
	if (filter.userId && message.authorId !== filter.userId) return false;
	if (filter.bots && !message.authorBot) return false;
	if (filter.links && !LINK_PATTERN.test(message.content)) return false;
	if (filter.attachments && message.attachmentCount === 0) return false;
	if (filter.embeds && message.embedCount === 0) return false;
	if (filter.contains && !message.content.toLowerCase().includes(filter.contains.toLowerCase())) return false;
	return true;
}

export function describePurgeFilter(filter: PurgeFilter): string {
	const parts: string[] = [];
	if (filter.userId) parts.push(`from <@${filter.userId}>`);
	if (filter.bots) parts.push('from bots');
	if (filter.links) parts.push('with links');
	if (filter.attachments) parts.push('with attachments');
	if (filter.embeds) parts.push('with embeds');
	if (filter.contains) parts.push(`containing "${filter.contains}"`);
	return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

export interface ModCase {
	guild_id: string;
	case_number: number;
	action: ModAction;
	target_type: ModTargetType;
	target_id: string;
	target_tag: string | null;
	moderator_id: string;
	moderator_tag: string | null;
	reason: string | null;
	duration_ms: number | null;
	expires_at: string | null;
	created_at: string;
	log_channel_id: string | null;
	log_message_id: string | null;
}

export interface NewModCase {
	guildId: string;
	action: ModAction;
	targetType?: ModTargetType;
	targetId: string;
	targetTag?: string | null;
	moderatorId: string;
	moderatorTag?: string | null;
	reason?: string | null;
	durationMs?: number | null;
	/** Defaults to now + durationMs for actions that expire. */
	expiresAt?: Date | null;
	now?: Date;
}

const bumpCounter = db.prepare(
	`INSERT INTO mod_case_counter (guild_id, last_case) VALUES (?, 1)
	ON CONFLICT(guild_id) DO UPDATE SET last_case = last_case + 1
	RETURNING last_case`
);
const insertCase = db.prepare(
	`INSERT INTO mod_cases (guild_id, case_number, action, target_type, target_id, target_tag, moderator_id, moderator_tag,
		reason, duration_ms, expires_at, created_at)
	VALUES (@guild_id, @case_number, @action, @target_type, @target_id, @target_tag, @moderator_id, @moderator_tag,
		@reason, @duration_ms, @expires_at, @created_at)`
);

const createCaseTx = db.transaction((input: NewModCase): ModCase => {
	const { last_case } = bumpCounter.get(input.guildId) as { last_case: number };
	const now = input.now ?? new Date();
	const durationMs = input.durationMs ?? null;
	const expiresAt = input.expiresAt !== undefined ? input.expiresAt : durationMs ? new Date(now.getTime() + durationMs) : null;
	const row: ModCase = {
		guild_id: input.guildId,
		case_number: last_case,
		action: input.action,
		target_type: input.targetType ?? 'user',
		target_id: input.targetId,
		target_tag: input.targetTag ?? null,
		moderator_id: input.moderatorId,
		moderator_tag: input.moderatorTag ?? null,
		reason: clampReason(input.reason),
		duration_ms: durationMs,
		expires_at: expiresAt ? expiresAt.toISOString() : null,
		created_at: now.toISOString(),
		log_channel_id: null,
		log_message_id: null
	};
	insertCase.run(row);
	return row;
});

/** Allocates the next case number for the guild and stores the case, atomically. */
export function createCase(input: NewModCase): ModCase {
	return createCaseTx(input);
}

export function getCase(guildId: string, caseNumber: number): ModCase | null {
	return (db.prepare(`SELECT * FROM mod_cases WHERE guild_id = ? AND case_number = ?`).get(guildId, caseNumber) as ModCase | undefined) ?? null;
}

export function getCasesForTarget(guildId: string, targetId: string, limit = 25): ModCase[] {
	return db
		.prepare(`SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? ORDER BY case_number DESC LIMIT ?`)
		.all(guildId, targetId, limit) as ModCase[];
}

export function countCasesForTarget(guildId: string, targetId: string): number {
	return (db.prepare(`SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND target_id = ?`).get(guildId, targetId) as { n: number }).n;
}

export function setCaseReason(guildId: string, caseNumber: number, reason: string | null): boolean {
	return (
		db.prepare(`UPDATE mod_cases SET reason = ? WHERE guild_id = ? AND case_number = ?`).run(clampReason(reason), guildId, caseNumber).changes > 0
	);
}

export function setCaseLogMessage(guildId: string, caseNumber: number, channelId: string, messageId: string): void {
	db.prepare(`UPDATE mod_cases SET log_channel_id = ?, log_message_id = ? WHERE guild_id = ? AND case_number = ?`).run(
		channelId,
		messageId,
		guildId,
		caseNumber
	);
}

export function deleteCase(guildId: string, caseNumber: number): boolean {
	return db.prepare(`DELETE FROM mod_cases WHERE guild_id = ? AND case_number = ?`).run(guildId, caseNumber).changes > 0;
}

// ---------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------

export interface ModNote {
	id: number;
	guild_id: string;
	target_id: string;
	author_id: string;
	author_tag: string | null;
	content: string;
	created_at: string;
}

export const MAX_NOTE_LENGTH = 1000;

export function addNote(guildId: string, targetId: string, authorId: string, authorTag: string | null, content: string, now = new Date()): ModNote {
	const text = content.trim().slice(0, MAX_NOTE_LENGTH);
	const result = db
		.prepare(`INSERT INTO mod_notes (guild_id, target_id, author_id, author_tag, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
		.run(guildId, targetId, authorId, authorTag, text, now.toISOString());
	return {
		id: Number(result.lastInsertRowid),
		guild_id: guildId,
		target_id: targetId,
		author_id: authorId,
		author_tag: authorTag,
		content: text,
		created_at: now.toISOString()
	};
}

export function getNotes(guildId: string, targetId: string, limit = 25): ModNote[] {
	return db
		.prepare(`SELECT * FROM mod_notes WHERE guild_id = ? AND target_id = ? ORDER BY id DESC LIMIT ?`)
		.all(guildId, targetId, limit) as ModNote[];
}

export function deleteNote(guildId: string, noteId: number): boolean {
	return db.prepare(`DELETE FROM mod_notes WHERE guild_id = ? AND id = ?`).run(guildId, noteId).changes > 0;
}

// ---------------------------------------------------------------------------------------------
// Timed actions
// ---------------------------------------------------------------------------------------------

export type ScheduledActionType = 'unban' | 'role-remove';

export interface ScheduledAction {
	id: number;
	guild_id: string;
	action: ScheduledActionType;
	target_id: string;
	role_id: string;
	run_at: string;
	case_number: number | null;
	attempts: number;
}

/** After this many failed runs a timed action is dropped, so one broken entry can't retry forever. */
export const MAX_SCHEDULE_ATTEMPTS = 5;

/** Schedules (or reschedules) an action. A second temp-ban on the same user replaces the first. */
export function scheduleAction(
	guildId: string,
	action: ScheduledActionType,
	targetId: string,
	runAt: Date,
	caseNumber: number | null,
	roleId: string | null = null
): void {
	db.prepare(
		`INSERT INTO mod_scheduled_actions (guild_id, action, target_id, role_id, run_at, case_number, attempts)
		VALUES (?, ?, ?, ?, ?, ?, 0)
		ON CONFLICT(guild_id, action, target_id, role_id) DO UPDATE SET run_at = excluded.run_at, case_number = excluded.case_number, attempts = 0`
	).run(guildId, action, targetId, roleId ?? '', runAt.toISOString(), caseNumber);
}

export function cancelScheduledAction(guildId: string, action: ScheduledActionType, targetId: string, roleId: string | null = null): boolean {
	return (
		db
			.prepare(`DELETE FROM mod_scheduled_actions WHERE guild_id = ? AND action = ? AND target_id = ? AND role_id = ?`)
			.run(guildId, action, targetId, roleId ?? '').changes > 0
	);
}

export function getDueActions(now = new Date(), limit = 50): ScheduledAction[] {
	return db
		.prepare(`SELECT * FROM mod_scheduled_actions WHERE run_at <= ? ORDER BY run_at LIMIT ?`)
		.all(now.toISOString(), limit) as ScheduledAction[];
}

export function getScheduledActions(guildId: string, targetId: string): ScheduledAction[] {
	return db
		.prepare(`SELECT * FROM mod_scheduled_actions WHERE guild_id = ? AND target_id = ? ORDER BY run_at`)
		.all(guildId, targetId) as ScheduledAction[];
}

export function completeScheduledAction(id: number): void {
	db.prepare(`DELETE FROM mod_scheduled_actions WHERE id = ?`).run(id);
}

/** Records a failed run and pushes the retry back. Returns false once the action is given up on (and removed). */
export function failScheduledAction(id: number, now = new Date(), retryMs = 60_000): boolean {
	const row = db.prepare(`SELECT attempts FROM mod_scheduled_actions WHERE id = ?`).get(id) as { attempts: number } | undefined;
	if (!row) return false;
	if (row.attempts + 1 >= MAX_SCHEDULE_ATTEMPTS) {
		completeScheduledAction(id);
		return false;
	}
	db.prepare(`UPDATE mod_scheduled_actions SET attempts = attempts + 1, run_at = ? WHERE id = ?`).run(
		new Date(now.getTime() + retryMs).toISOString(),
		id
	);
	return true;
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export interface ModConfig {
	guild_id: string;
	log_channel_id: string | null;
	dm_actions: DmAction[];
}

function parseDmActions(raw: string | null): DmAction[] {
	if (raw === null) return [...DM_ACTIONS];
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter(isDmAction);
}

export function getModConfig(guildId: string): ModConfig {
	const row = db.prepare(`SELECT log_channel_id, dm_actions FROM mod_config WHERE guild_id = ?`).get(guildId) as
		{ log_channel_id: string | null; dm_actions: string | null } | undefined;
	return {
		guild_id: guildId,
		log_channel_id: row?.log_channel_id ?? null,
		dm_actions: parseDmActions(row?.dm_actions ?? null)
	};
}

export function setModLogChannel(guildId: string, channelId: string | null): void {
	db.prepare(
		`INSERT INTO mod_config (guild_id, log_channel_id) VALUES (?, ?)
		ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`
	).run(guildId, channelId);
}

export function setDmOnAction(guildId: string, action: DmAction, enabled: boolean): void {
	const current = new Set(getModConfig(guildId).dm_actions);
	if (enabled) current.add(action);
	else current.delete(action);
	// Kept in DM_ACTIONS order so the stored value (and its audit row) is stable.
	const value = DM_ACTIONS.filter((entry) => current.has(entry)).join(',');
	db.prepare(
		`INSERT INTO mod_config (guild_id, dm_actions) VALUES (?, ?)
		ON CONFLICT(guild_id) DO UPDATE SET dm_actions = excluded.dm_actions`
	).run(guildId, value);
}

export function shouldDm(guildId: string, action: ModAction): boolean {
	return isDmAction(action) && getModConfig(guildId).dm_actions.includes(action);
}

// ---------------------------------------------------------------------------------------------
// Lockdown bookkeeping
// ---------------------------------------------------------------------------------------------

/** Permission name → its state in the @everyone overwrite: true (allow), false (deny), null (inherit). */
export type OverwriteState = Record<string, boolean | null>;

export function markChannelLocked(guildId: string, channelId: string, previous: OverwriteState): void {
	db.prepare(
		`INSERT INTO mod_locked_channels (guild_id, channel_id, previous) VALUES (?, ?, ?)
		ON CONFLICT(guild_id, channel_id) DO UPDATE SET previous = excluded.previous`
	).run(guildId, channelId, JSON.stringify(previous));
}

/** Forgets a lock and returns the overwrite state to restore, or null if Lyra didn't lock it. */
export function takeChannelLock(guildId: string, channelId: string): OverwriteState | null {
	const row = db.prepare(`SELECT previous FROM mod_locked_channels WHERE guild_id = ? AND channel_id = ?`).get(guildId, channelId) as
		{ previous: string } | undefined;
	if (!row) return null;
	db.prepare(`DELETE FROM mod_locked_channels WHERE guild_id = ? AND channel_id = ?`).run(guildId, channelId);
	try {
		return JSON.parse(row.previous) as OverwriteState;
	} catch {
		return {};
	}
}

export function getLockedChannels(guildId: string): string[] {
	return (db.prepare(`SELECT channel_id FROM mod_locked_channels WHERE guild_id = ?`).all(guildId) as { channel_id: string }[]).map(
		(row) => row.channel_id
	);
}

export function isChannelLockedByBot(guildId: string, channelId: string): boolean {
	return db.prepare(`SELECT 1 FROM mod_locked_channels WHERE guild_id = ? AND channel_id = ?`).get(guildId, channelId) !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

export const ACTION_LABELS: Record<ModAction, string> = {
	warn: 'Warn',
	timeout: 'Timeout',
	untimeout: 'Timeout removed',
	kick: 'Kick',
	ban: 'Ban',
	unban: 'Unban',
	softban: 'Softban',
	purge: 'Purge',
	slowmode: 'Slowmode',
	lock: 'Lock',
	unlock: 'Unlock',
	nick: 'Nickname',
	'role-add': 'Role added',
	'role-remove': 'Role removed'
};

/** Past tense for the DM: "You were **banned** from …". */
export const ACTION_VERBS: Record<DmAction, string> = {
	warn: 'warned in',
	timeout: 'timed out in',
	untimeout: 'no longer timed out in',
	kick: 'kicked from',
	ban: 'banned from',
	softban: 'softbanned from'
};

export function formatTarget(modCase: Pick<ModCase, 'target_type' | 'target_id' | 'target_tag'>): string {
	if (modCase.target_type === 'channel') return `<#${modCase.target_id}>`;
	if (modCase.target_type === 'guild') return 'the whole server';
	return modCase.target_tag ? `<@${modCase.target_id}> (${modCase.target_tag})` : `<@${modCase.target_id}>`;
}

/** One line per case for /modlogs. */
export function formatCaseLine(modCase: ModCase): string {
	const when = `<t:${Math.floor(new Date(modCase.created_at).getTime() / 1000)}:d>`;
	const duration = modCase.duration_ms ? ` (${formatDuration(modCase.duration_ms)})` : '';
	const reason = modCase.reason ? ` — ${modCase.reason}` : '';
	return `**#${modCase.case_number}** ${ACTION_LABELS[modCase.action] ?? modCase.action}${duration} · ${when} by <@${modCase.moderator_id}>${reason}`;
}
