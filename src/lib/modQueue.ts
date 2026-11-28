import { db } from './database';

/**
 * Data for the member-facing side of moderation (LYRA-12): reports, tickets and ban appeals,
 * plus where each of them goes. The Discord side (embeds, buttons, threads) is in
 * src/lib/modQueueActions.ts.
 */

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export interface ModQueueConfig {
	guild_id: string;
	report_channel_id: string | null;
	ticket_channel_id: string | null;
	staff_role_id: string | null;
	appeal_channel_id: string | null;
	appeal_url: string | null;
}

export type ModQueueField = Exclude<keyof ModQueueConfig, 'guild_id'>;

const QUEUE_FIELDS: readonly ModQueueField[] = ['report_channel_id', 'ticket_channel_id', 'staff_role_id', 'appeal_channel_id', 'appeal_url'];

export function getModQueueConfig(guildId: string): ModQueueConfig {
	const row = db.prepare(`SELECT * FROM mod_queue_config WHERE guild_id = ?`).get(guildId) as ModQueueConfig | undefined;
	return {
		guild_id: guildId,
		report_channel_id: row?.report_channel_id ?? null,
		ticket_channel_id: row?.ticket_channel_id ?? null,
		staff_role_id: row?.staff_role_id ?? null,
		appeal_channel_id: row?.appeal_channel_id ?? null,
		appeal_url: row?.appeal_url ?? null
	};
}

export function setModQueueField(guildId: string, field: ModQueueField, value: string | null): void {
	if (!QUEUE_FIELDS.includes(field)) throw new Error(`unknown mod queue field ${field}`);
	db.prepare(
		`INSERT INTO mod_queue_config (guild_id, ${field}) VALUES (?, ?)
		ON CONFLICT(guild_id) DO UPDATE SET ${field} = excluded.${field}`
	).run(guildId, value);
}

/** Only http(s) links are offered to banned members, so a typo can't become a `javascript:` link. */
export function isAppealUrl(text: string): boolean {
	try {
		const url = new URL(text);
		return (url.protocol === 'https:' || url.protocol === 'http:') && text.length <= 512;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface ModReport {
	id: number;
	guild_id: string;
	reporter_id: string;
	target_id: string;
	target_tag: string | null;
	reason: string;
	channel_id: string | null;
	message_id: string | null;
	message_content: string | null;
	status: ReportStatus;
	handled_by: string | null;
	handled_at: string | null;
	queue_message_id: string | null;
	created_at: string;
}

export interface NewReport {
	guildId: string;
	reporterId: string;
	targetId: string;
	targetTag?: string | null;
	reason: string;
	channelId?: string | null;
	messageId?: string | null;
	messageContent?: string | null;
	now?: Date;
}

export const MAX_REPORT_REASON = 1000;
/** Enough of the reported message to judge it; the rest is a click away while it still exists. */
export const MAX_REPORTED_CONTENT = 1000;
/** A member can file this many reports per window, so the queue can't be flooded. */
export const REPORT_LIMIT = 5;
export const REPORT_WINDOW_MS = 10 * 60 * 1000;

export function createReport(input: NewReport): ModReport {
	const now = (input.now ?? new Date()).toISOString();
	const reason = input.reason.trim().slice(0, MAX_REPORT_REASON);
	const content = input.messageContent ? input.messageContent.slice(0, MAX_REPORTED_CONTENT) : null;
	const result = db
		.prepare(
			`INSERT INTO mod_reports (guild_id, reporter_id, target_id, target_tag, reason, channel_id, message_id, message_content, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.guildId,
			input.reporterId,
			input.targetId,
			input.targetTag ?? null,
			reason,
			input.channelId ?? null,
			input.messageId ?? null,
			content,
			now
		);
	return getReport(input.guildId, Number(result.lastInsertRowid))!;
}

export function getReport(guildId: string, id: number): ModReport | null {
	return (db.prepare(`SELECT * FROM mod_reports WHERE guild_id = ? AND id = ?`).get(guildId, id) as ModReport | undefined) ?? null;
}

/** Reports this member filed inside the rate window. */
export function recentReportCount(guildId: string, reporterId: string, now = new Date()): number {
	const since = new Date(now.getTime() - REPORT_WINDOW_MS).toISOString();
	return (
		db
			.prepare(`SELECT COUNT(*) AS n FROM mod_reports WHERE guild_id = ? AND reporter_id = ? AND created_at > ?`)
			.get(guildId, reporterId, since) as {
			n: number;
		}
	).n;
}

/** An open report on the same message by the same member, so a double click doesn't file twice. */
export function findOpenDuplicate(guildId: string, reporterId: string, targetId: string, messageId: string | null): ModReport | null {
	const row = db
		.prepare(
			`SELECT * FROM mod_reports WHERE guild_id = ? AND reporter_id = ? AND target_id = ? AND status = 'open'
			AND COALESCE(message_id, '') = ? ORDER BY id DESC LIMIT 1`
		)
		.get(guildId, reporterId, targetId, messageId ?? '') as ModReport | undefined;
	return row ?? null;
}

export function setReportQueueMessage(guildId: string, id: number, messageId: string): void {
	db.prepare(`UPDATE mod_reports SET queue_message_id = ? WHERE guild_id = ? AND id = ?`).run(messageId, guildId, id);
}

/**
 * Closes an open report. Returns false if it was already handled, so two moderators clicking at
 * once can't both act on it.
 */
export function closeReport(guildId: string, id: number, status: Exclude<ReportStatus, 'open'>, handledBy: string, now = new Date()): boolean {
	return (
		db
			.prepare(`UPDATE mod_reports SET status = ?, handled_by = ?, handled_at = ? WHERE guild_id = ? AND id = ? AND status = 'open'`)
			.run(status, handledBy, now.toISOString(), guildId, id).changes > 0
	);
}

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

export interface ModTicket {
	id: number;
	guild_id: string;
	user_id: string;
	thread_id: string;
	subject: string | null;
	status: 'open' | 'closed';
	opened_at: string;
	closed_at: string | null;
	closed_by: string | null;
}

export const MAX_TICKET_SUBJECT = 100;

export function getOpenTicket(guildId: string, userId: string): ModTicket | null {
	return (
		(db
			.prepare(`SELECT * FROM mod_tickets WHERE guild_id = ? AND user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`)
			.get(guildId, userId) as ModTicket | undefined) ?? null
	);
}

export function getTicketByThread(threadId: string): ModTicket | null {
	return (db.prepare(`SELECT * FROM mod_tickets WHERE thread_id = ?`).get(threadId) as ModTicket | undefined) ?? null;
}

export function createTicket(guildId: string, userId: string, threadId: string, subject: string | null, now = new Date()): ModTicket {
	const text = subject?.trim() ? subject.trim().slice(0, MAX_TICKET_SUBJECT) : null;
	const result = db
		.prepare(`INSERT INTO mod_tickets (guild_id, user_id, thread_id, subject, opened_at) VALUES (?, ?, ?, ?, ?)`)
		.run(guildId, userId, threadId, text, now.toISOString());
	return db.prepare(`SELECT * FROM mod_tickets WHERE id = ?`).get(Number(result.lastInsertRowid)) as ModTicket;
}

/** Returns false if the ticket was already closed. */
export function closeTicket(threadId: string, closedBy: string, now = new Date()): boolean {
	return (
		db
			.prepare(`UPDATE mod_tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE thread_id = ? AND status = 'open'`)
			.run(now.toISOString(), closedBy, threadId).changes > 0
	);
}

/** Thread names: `ticket-username` plus the subject when there is one, inside Discord's 100 characters. */
export function ticketThreadName(username: string, subject: string | null): string {
	const base = `ticket-${username}`;
	return (subject ? `${base} · ${subject}` : base).slice(0, 100);
}

// ---------------------------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------------------------

export type AppealStatus = 'pending' | 'accepted' | 'denied';

export interface ModAppeal {
	id: number;
	guild_id: string;
	user_id: string;
	user_tag: string | null;
	content: string;
	status: AppealStatus;
	handled_by: string | null;
	handled_at: string | null;
	queue_message_id: string | null;
	created_at: string;
}

export const MAX_APPEAL_LENGTH = 1500;
/** After a denial the member waits this long before appealing again. */
export const APPEAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function getAppeal(guildId: string, id: number): ModAppeal | null {
	return (db.prepare(`SELECT * FROM mod_appeals WHERE guild_id = ? AND id = ?`).get(guildId, id) as ModAppeal | undefined) ?? null;
}

export function latestAppeal(guildId: string, userId: string): ModAppeal | null {
	return (
		(db.prepare(`SELECT * FROM mod_appeals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`).get(guildId, userId) as
			ModAppeal | undefined) ?? null
	);
}

/** Why this member can't appeal right now, or null if they can. Only the ban check needs Discord. */
export function appealBlocker(latest: ModAppeal | null, now = new Date()): string | null {
	if (!latest) return null;
	if (latest.status === 'pending') return 'you already have an appeal waiting for the moderators.';
	if (latest.status === 'denied' && latest.handled_at) {
		const until = new Date(latest.handled_at).getTime() + APPEAL_COOLDOWN_MS;
		if (now.getTime() < until) return `your last appeal was denied. you can appeal again <t:${Math.floor(until / 1000)}:R>.`;
	}
	return null;
}

export function createAppeal(guildId: string, userId: string, userTag: string | null, content: string, now = new Date()): ModAppeal {
	const result = db
		.prepare(`INSERT INTO mod_appeals (guild_id, user_id, user_tag, content, created_at) VALUES (?, ?, ?, ?, ?)`)
		.run(guildId, userId, userTag, content.trim().slice(0, MAX_APPEAL_LENGTH), now.toISOString());
	return getAppeal(guildId, Number(result.lastInsertRowid))!;
}

export function setAppealQueueMessage(guildId: string, id: number, messageId: string): void {
	db.prepare(`UPDATE mod_appeals SET queue_message_id = ? WHERE guild_id = ? AND id = ?`).run(messageId, guildId, id);
}

/** Returns false if someone else already decided it. */
export function decideAppeal(guildId: string, id: number, status: Exclude<AppealStatus, 'pending'>, handledBy: string, now = new Date()): boolean {
	return (
		db
			.prepare(`UPDATE mod_appeals SET status = ?, handled_by = ?, handled_at = ? WHERE guild_id = ? AND id = ? AND status = 'pending'`)
			.run(status, handledBy, now.toISOString(), guildId, id).changes > 0
	);
}

/** Puts a decision back, when Discord refused the unban that an accept needed. */
export function reopenAppeal(guildId: string, id: number): void {
	db.prepare(`UPDATE mod_appeals SET status = 'pending', handled_by = NULL, handled_at = NULL WHERE guild_id = ? AND id = ?`).run(guildId, id);
}
