import type { GuildMember } from 'discord.js';

import { db } from './database';
import { getMusicConfig, getVoiceAssistantConfig } from './config';
import { getStarboardBlacklist, getStarboardConfig, type BlacklistTargetType } from './starboard';

/** Where the change came in from. The dashboard and Discord both write config, so both are logged. */
export type AuditSource = 'dashboard' | 'discord';

export type AuditSection = 'music' | 'starboard' | 'starboard_blacklist' | 'voice' | 'permissions' | 'triggers' | 'voice_triggers';

/** Who made the change. Resolved at write time, since the member may leave before anyone reads the log. */
export interface AuditActor {
	id: string;
	name: string;
	source: AuditSource;
}

export interface ConfigAuditRow {
	id: number;
	guild_id: string;
	actor_id: string;
	actor_name: string;
	source: AuditSource;
	section: AuditSection;
	setting: string;
	old_value: string | null;
	new_value: string | null;
	created_at: string;
}

export function auditActor(member: GuildMember, source: AuditSource): AuditActor {
	// Username, not display name: nicknames change, and a stale nickname in an audit row
	// is worse than a plain username when you're trying to work out who did something.
	return { id: member.id, name: member.user.username, source };
}

/**
 * Values land in one TEXT column so a single table covers every settings group.
 * null means "unset", which is distinct from the string "null" a JSON dump would give.
 */
function serialize(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
}

const insert = db.prepare(
	`INSERT INTO config_audit (guild_id, actor_id, actor_name, source, section, setting, old_value, new_value, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

/** Records one setting change. A no-op write (old === new) is dropped, so re-saving a form logs nothing. */
export function recordConfigChange(
	guildId: string,
	actor: AuditActor,
	section: AuditSection,
	setting: string,
	oldValue: unknown,
	newValue: unknown
): void {
	const before = serialize(oldValue);
	const after = serialize(newValue);
	if (before === after) return;
	insert.run(guildId, actor.id, actor.name, actor.source, section, setting, before, after, new Date().toISOString());
}

/** Diffs two snapshots of a settings group and records a row per field that actually moved. */
export function recordConfigDiff(guildId: string, actor: AuditActor, section: AuditSection, before: object, after: object): void {
	const previous = before as Record<string, unknown>;
	for (const [key, value] of Object.entries(after)) {
		if (key === 'guild_id') continue;
		recordConfigChange(guildId, actor, section, key, previous[key], value);
	}
}

const SNAPSHOT: Record<'music' | 'starboard' | 'voice', (guildId: string) => object> = {
	music: getMusicConfig,
	starboard: getStarboardConfig,
	voice: getVoiceAssistantConfig
};

/**
 * Runs a config mutation with a before/after snapshot around it. Call sites that fire one
 * setter at a time (the slash commands) get audited without each of them hand-rolling a diff.
 */
export function auditConfigMutation(section: keyof typeof SNAPSHOT, guildId: string, actor: AuditActor, apply: () => void): void {
	const read = SNAPSHOT[section];
	const before = read(guildId);
	apply();
	recordConfigDiff(guildId, actor, section, before, read(guildId));
}

/**
 * Starboard blacklist add/remove, recorded as one target going on or off the list.
 * Both underlying writes are idempotent, so presence around the call is what decides
 * whether anything changed - a redundant add logs nothing.
 */
export function auditStarboardBlacklist(
	guildId: string,
	actor: AuditActor,
	targetId: string,
	targetType: BlacklistTargetType,
	apply: () => void
): void {
	const listed = () => getStarboardBlacklist(guildId).some((entry) => entry.target_id === targetId && entry.target_type === targetType);
	const before = listed();
	apply();
	recordConfigChange(
		guildId,
		actor,
		'starboard_blacklist',
		`${targetType}:${targetId}`,
		before ? 'blacklisted' : null,
		listed() ? 'blacklisted' : null
	);
}

export interface AuditQuery {
	limit?: number;
	offset?: number;
	/** Restrict to one settings group; omit for everything. */
	section?: AuditSection;
}

export function getConfigAudit(guildId: string, query: AuditQuery = {}): ConfigAuditRow[] {
	const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
	const offset = Math.max(query.offset ?? 0, 0);
	if (query.section) {
		return db
			.prepare(`SELECT * FROM config_audit WHERE guild_id = ? AND section = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
			.all(guildId, query.section, limit, offset) as ConfigAuditRow[];
	}
	return db
		.prepare(`SELECT * FROM config_audit WHERE guild_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
		.all(guildId, limit, offset) as ConfigAuditRow[];
}

/** Distinct sections present for a guild, so the UI's filter only offers rows that exist. */
export function getAuditSections(guildId: string): AuditSection[] {
	return (
		db.prepare(`SELECT DISTINCT section FROM config_audit WHERE guild_id = ? ORDER BY section`).all(guildId) as { section: AuditSection }[]
	).map((row) => row.section);
}
