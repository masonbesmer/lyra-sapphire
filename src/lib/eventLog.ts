import { AuditLogEvent, PermissionsBitField, type PermissionResolvable } from 'discord.js';
import { db } from './database';
import { getModConfig, type ModAction } from './moderation';

/**
 * Event logging data and the rules that don't need a live client: which channel each event goes
 * to, ignore lists, change diffs, invite matching and turning a Discord audit-log entry into a
 * mod case. Posting lives in src/lib/eventLogPost.ts; the listeners are in src/listeners/eventLog/.
 */

// ---------------------------------------------------------------------------------------------
// Events and groups
// ---------------------------------------------------------------------------------------------

export const LOG_GROUPS = {
	messages: ['message_edit', 'message_delete', 'message_bulk_delete'],
	members: ['member_join', 'member_leave', 'member_nick', 'member_roles', 'member_avatar'],
	voice: ['voice_join', 'voice_leave', 'voice_move'],
	server: ['channel_changes', 'role_changes', 'emoji_changes', 'server_changes']
} as const;

export type LogGroup = keyof typeof LOG_GROUPS;
export type LogEvent = (typeof LOG_GROUPS)[LogGroup][number];

export const LOG_EVENTS: readonly LogEvent[] = Object.values(LOG_GROUPS).flat();

export const LOG_EVENT_LABELS: Record<LogEvent, string> = {
	message_edit: 'Message edited',
	message_delete: 'Message deleted',
	message_bulk_delete: 'Messages bulk-deleted',
	member_join: 'Member joined',
	member_leave: 'Member left',
	member_nick: 'Nickname changed',
	member_roles: 'Roles changed',
	member_avatar: 'Avatar changed',
	voice_join: 'Voice join',
	voice_leave: 'Voice leave',
	voice_move: 'Voice move',
	channel_changes: 'Channel created / changed / deleted',
	role_changes: 'Role created / changed / deleted',
	emoji_changes: 'Emoji added / changed / removed',
	server_changes: 'Server settings changed'
};

export function isLogEvent(value: string): value is LogEvent {
	return (LOG_EVENTS as readonly string[]).includes(value);
}

export function isLogGroup(value: string): value is LogGroup {
	return Object.hasOwn(LOG_GROUPS, value);
}

/** `all`, a group name or a single event → the events it covers. Empty for anything else. */
export function resolveLogEvents(selector: string): LogEvent[] {
	const value = selector.trim().toLowerCase();
	if (value === 'all') return [...LOG_EVENTS];
	if (isLogGroup(value)) return [...LOG_GROUPS[value]];
	if (isLogEvent(value)) return [value];
	return [];
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export function getLogRoutes(guildId: string): Partial<Record<LogEvent, string>> {
	const rows = db.prepare(`SELECT event, channel_id FROM log_routes WHERE guild_id = ?`).all(guildId) as { event: string; channel_id: string }[];
	const routes: Partial<Record<LogEvent, string>> = {};
	for (const row of rows) if (isLogEvent(row.event)) routes[row.event] = row.channel_id;
	return routes;
}

export function getLogChannel(guildId: string, event: LogEvent): string | null {
	const row = db.prepare(`SELECT channel_id FROM log_routes WHERE guild_id = ? AND event = ?`).get(guildId, event) as
		{ channel_id: string } | undefined;
	return row?.channel_id ?? null;
}

const upsertRoute = db.prepare(
	`INSERT INTO log_routes (guild_id, event, channel_id) VALUES (?, ?, ?)
	ON CONFLICT(guild_id, event) DO UPDATE SET channel_id = excluded.channel_id`
);
const deleteRoute = db.prepare(`DELETE FROM log_routes WHERE guild_id = ? AND event = ?`);

const setLogRoutesTx = db.transaction((guildId: string, events: readonly LogEvent[], channelId: string | null) => {
	for (const event of events) {
		if (channelId) upsertRoute.run(guildId, event, channelId);
		else deleteRoute.run(guildId, event);
	}
});

/** Routes every given event to the channel, or stops logging them when channelId is null. */
export function setLogRoutes(guildId: string, events: readonly LogEvent[], channelId: string | null): void {
	setLogRoutesTx(guildId, events, channelId);
}

/**
 * Channels whose own messages are never logged: every event-log channel plus the mod log.
 * Logging a deletion in the log channel would log the log.
 */
export function isLogDestination(guildId: string, channelId: string): boolean {
	if (getModConfig(guildId).log_channel_id === channelId) return true;
	return db.prepare(`SELECT 1 FROM log_routes WHERE guild_id = ? AND channel_id = ?`).get(guildId, channelId) !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Ignore lists
// ---------------------------------------------------------------------------------------------

export type LogIgnoreType = 'channel' | 'user';

export function addLogIgnore(guildId: string, type: LogIgnoreType, targetId: string): boolean {
	return (
		db.prepare(`INSERT OR IGNORE INTO log_ignores (guild_id, target_type, target_id) VALUES (?, ?, ?)`).run(guildId, type, targetId).changes > 0
	);
}

export function removeLogIgnore(guildId: string, type: LogIgnoreType, targetId: string): boolean {
	return db.prepare(`DELETE FROM log_ignores WHERE guild_id = ? AND target_type = ? AND target_id = ?`).run(guildId, type, targetId).changes > 0;
}

export function getLogIgnores(guildId: string): Record<LogIgnoreType, string[]> {
	const rows = db.prepare(`SELECT target_type, target_id FROM log_ignores WHERE guild_id = ? ORDER BY target_id`).all(guildId) as {
		target_type: LogIgnoreType;
		target_id: string;
	}[];
	const result: Record<LogIgnoreType, string[]> = { channel: [], user: [] };
	for (const row of rows) result[row.target_type]?.push(row.target_id);
	return result;
}

export interface IgnoreSubject {
	/** The channel, its parent (for threads) and its category: an ignored category covers its channels. */
	channelIds?: (string | null | undefined)[];
	userId?: string | null;
}

export function isLogIgnored(guildId: string, subject: IgnoreSubject): boolean {
	const ignores = getLogIgnores(guildId);
	if (subject.userId && ignores.user.includes(subject.userId)) return true;
	return (subject.channelIds ?? []).some((id) => id && ignores.channel.includes(id));
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

/** Embed field values cap at 1024 characters. */
export const FIELD_MAX = 1024;

export function truncate(text: string, max = FIELD_MAX): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Message content for an embed field: never empty and never over the cap. */
export function quoteContent(content: string | null | undefined, max = FIELD_MAX): string {
	if (content === null || content === undefined) return '_not cached_';
	if (!content.trim()) return '_no text_';
	return truncate(content, max);
}

/** Accounts younger than this get a ⚠️ on the join log: the usual sign of an alt or a raid. */
export const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;

export function accountAgeLine(createdTimestamp: number, now = Date.now()): string {
	const seconds = Math.floor(createdTimestamp / 1000);
	const flag = now - createdTimestamp < NEW_ACCOUNT_MS ? ' ⚠️ new account' : '';
	return `<t:${seconds}:R> (<t:${seconds}:d>)${flag}`;
}

export function diffIds(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
	const old = new Set(before);
	const now = new Set(after);
	return {
		added: [...now].filter((id) => !old.has(id)),
		removed: [...old].filter((id) => !now.has(id))
	};
}

export interface FieldChange {
	name: string;
	before: unknown;
	after: unknown;
	/** How to show a value; defaults to String() with `none` for empty values. */
	format?: (value: unknown) => string;
}

function showValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '_none_';
	return String(value);
}

/** One `**Name:** before → after` line per field that actually changed. */
export function describeChanges(changes: FieldChange[]): string[] {
	const lines: string[] = [];
	for (const change of changes) {
		if (change.before === change.after) continue;
		const format = change.format ?? showValue;
		lines.push(`**${change.name}:** ${format(change.before)} → ${format(change.after)}`);
	}
	return lines;
}

/** Permission names granted and revoked between two bitfields. */
export function permissionDiff(before: PermissionResolvable, after: PermissionResolvable): { added: string[]; removed: string[] } {
	const old = new PermissionsBitField(before).toArray();
	const now = new PermissionsBitField(after).toArray();
	return diffIds(old, now);
}

/** A channel id, or `none`, as a mention for change lines. */
export function channelMention(value: unknown): string {
	return typeof value === 'string' && value ? `<#${value}>` : '_none_';
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

export interface InviteSnapshot {
	code: string;
	uses: number;
	maxUses: number;
	inviterId: string | null;
}

/**
 * Which invite a new member used, by comparing use counts before and after the join. Exactly
 * one invite must have gained a use; failing that, a one-use-left invite that vanished (Discord
 * deletes an invite once it hits max uses). Anything else is ambiguous (two joins at once,
 * vanity URL, an invite created and used between snapshots), so it returns null.
 */
export function findUsedInvite(before: ReadonlyMap<string, InviteSnapshot>, after: readonly InviteSnapshot[]): InviteSnapshot | null {
	const grew = after.filter((invite) => invite.uses > (before.get(invite.code)?.uses ?? 0));
	if (grew.length === 1) return grew[0];
	if (grew.length > 1) return null;
	const present = new Set(after.map((invite) => invite.code));
	const vanished = [...before.values()].filter((invite) => !present.has(invite.code) && invite.maxUses > 0 && invite.uses + 1 >= invite.maxUses);
	return vanished.length === 1 ? { ...vanished[0], uses: vanished[0].uses + 1 } : null;
}

// ---------------------------------------------------------------------------------------------
// Manual actions from the audit log
// ---------------------------------------------------------------------------------------------

/** The parts of a GuildAuditLogsEntry this needs, so it can be tested without discord.js objects. */
export interface AuditEntryLike {
	action: AuditLogEvent;
	executorId: string | null;
	targetId: string | null;
	createdTimestamp: number;
	changes: readonly { key: string; old?: unknown; new?: unknown }[];
}

export interface ManualCase {
	action: Extract<ModAction, 'ban' | 'unban' | 'kick' | 'timeout' | 'untimeout'>;
	durationMs: number | null;
	expiresAt: Date | null;
}

/**
 * Turns an audit-log entry for a ban, unban, kick or timeout done outside Lyra into a case, or
 * returns null. Entries Lyra made herself are skipped: her commands already opened the case.
 */
export function manualCaseFromAudit(entry: AuditEntryLike, botId: string): ManualCase | null {
	if (!entry.executorId || entry.executorId === botId || !entry.targetId) return null;
	switch (entry.action) {
		case AuditLogEvent.MemberBanAdd:
			return { action: 'ban', durationMs: null, expiresAt: null };
		case AuditLogEvent.MemberBanRemove:
			return { action: 'unban', durationMs: null, expiresAt: null };
		case AuditLogEvent.MemberKick:
			return { action: 'kick', durationMs: null, expiresAt: null };
		case AuditLogEvent.MemberUpdate: {
			const change = entry.changes.find((item) => item.key === 'communication_disabled_until');
			if (!change) return null;
			const until = typeof change.new === 'string' ? Date.parse(change.new) : NaN;
			if (Number.isNaN(until)) return { action: 'untimeout', durationMs: null, expiresAt: null };
			// A timeout set in the past is how some clients clear one.
			if (until <= entry.createdTimestamp) return { action: 'untimeout', durationMs: null, expiresAt: null };
			const durationMs = Math.round((until - entry.createdTimestamp) / 1000) * 1000;
			return { action: 'timeout', durationMs, expiresAt: new Date(until) };
		}
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------------------------
// Bulk-delete transcript
// ---------------------------------------------------------------------------------------------

export interface TranscriptMessage {
	id: string;
	partial: boolean;
	createdTimestamp: number | null;
	content?: string | null;
	author?: { id: string; username: string } | null;
	attachments?: { size: number; values(): Iterable<{ name: string }> };
}

/** A plain-text transcript of a bulk delete, oldest first. Messages that weren't cached show only their ID. */
export function bulkTranscript(messages: readonly TranscriptMessage[]): string {
	return messages
		.slice()
		.sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0))
		.map((message) => {
			if (message.partial || !message.author) return `[not cached] ${message.id}`;
			const when = message.createdTimestamp ? new Date(message.createdTimestamp).toISOString() : 'unknown time';
			const names = message.attachments?.size ? [...message.attachments.values()].map((attachment) => attachment.name) : [];
			const files = names.length ? ` [${names.join(', ')}]` : '';
			return `[${when}] ${message.author.username} (${message.author.id}): ${message.content ?? ''}${files}`;
		})
		.join('\n');
}

/** Join, leave or move, or null when only mute/deafen/stream state changed. */
export function voiceEvent(oldChannelId: string | null, newChannelId: string | null): Extract<LogEvent, `voice_${string}`> | null {
	if (oldChannelId === newChannelId) return null;
	if (!oldChannelId) return 'voice_join';
	if (!newChannelId) return 'voice_leave';
	return 'voice_move';
}
