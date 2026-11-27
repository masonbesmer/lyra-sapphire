import { PermissionFlagsBits } from 'discord.js';
import { db } from './database';

/**
 * Self-assign roles (LYRA-9): role panels (buttons, select menus, reactions), auto-role on join
 * and sticky roles. This module holds the rules and storage that don't need Discord; the
 * Discord side lives in src/lib/selfRoleActions.ts.
 */

// ---------------------------------------------------------------------------------------------
// Members intent
// ---------------------------------------------------------------------------------------------

/**
 * Auto-role and sticky roles need join/leave events, which only arrive with the privileged
 * Server Members intent. Asking for a privileged intent the Developer Portal hasn't granted makes
 * Discord refuse the login, so the bot only requests it when this is set to `true`.
 */
export function membersIntentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.DISCORD_MEMBERS_INTENT?.trim().toLowerCase() === 'true';
}

export const MEMBERS_INTENT_HINT =
	"-# ⚠️ join/leave events are off, so this won't do anything yet. Enable **Server Members Intent** in the Developer Portal, then set `DISCORD_MEMBERS_INTENT=true` and restart.";

// ---------------------------------------------------------------------------------------------
// Panel kinds and modes
// ---------------------------------------------------------------------------------------------

export const PANEL_KINDS = ['button', 'select', 'reaction'] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/**
 * normal: add and remove freely. unique: one role from the panel at a time. verify: add only
 * (e.g. accepting rules). drop: remove only.
 */
export const PANEL_MODES = ['normal', 'unique', 'verify', 'drop'] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

export function isPanelKind(value: string): value is PanelKind {
	return (PANEL_KINDS as readonly string[]).includes(value);
}

export function isPanelMode(value: string): value is PanelMode {
	return (PANEL_MODES as readonly string[]).includes(value);
}

export const MODE_HINTS: Record<PanelMode, string> = {
	normal: 'Pick as many as you like. Pick one again to drop it.',
	unique: 'You can hold one of these at a time.',
	verify: "Once you have a role here it can't be removed from this panel.",
	drop: 'Picking a role here removes it from you.'
};

/** Discord allows 25 buttons (5 rows of 5) or 25 select options per message, and 20 distinct reactions. */
export const MAX_ENTRIES: Record<PanelKind, number> = { button: 25, select: 25, reaction: 20 };
export const MAX_PANELS_PER_GUILD = 50;
export const MAX_LABEL_LENGTH = 80;
export const MAX_TITLE_LENGTH = 256;
export const MAX_DESCRIPTION_LENGTH = 1000;

// ---------------------------------------------------------------------------------------------
// Role changes
// ---------------------------------------------------------------------------------------------

export interface RoleChange {
	add: string[];
	remove: string[];
}

export type ToggleEvent = 'click' | 'react' | 'unreact';

/**
 * What one button click or reaction does to the member's roles. `panelRoles` are every role on
 * the panel, `held` the member's current roles. Only panel roles are ever touched.
 */
export function resolveToggle(
	mode: PanelMode,
	panelRoles: readonly string[],
	held: ReadonlySet<string>,
	roleId: string,
	event: ToggleEvent
): RoleChange {
	const has = held.has(roleId);
	const none: RoleChange = { add: [], remove: [] };
	const others = () => panelRoles.filter((id) => id !== roleId && held.has(id));

	if (event === 'unreact') {
		// Taking a reaction back undoes it only where adding and removing are both allowed.
		return (mode === 'normal' || mode === 'unique') && has ? { add: [], remove: [roleId] } : none;
	}

	// A click on a role you hold takes it back; a reaction on one is just a no-op re-add.
	const wantsRemoval = mode === 'drop' || (event === 'click' && has);
	if (wantsRemoval) {
		if (!has || mode === 'verify') return none;
		return { add: [], remove: [roleId] };
	}
	if (mode === 'unique') return { add: has ? [] : [roleId], remove: others() };
	return has ? none : { add: [roleId], remove: [] };
}

/** What submitting a select menu does: the selection is the wanted set of panel roles. */
export function resolveSelection(mode: PanelMode, panelRoles: readonly string[], held: ReadonlySet<string>, selected: readonly string[]): RoleChange {
	let valid = selected.filter((id) => panelRoles.includes(id));
	// The menu allows one pick in unique mode, but a crafted interaction could send more.
	if (mode === 'unique') valid = valid.slice(0, 1);
	const picked = new Set(valid);
	const add = [...picked].filter((id) => !held.has(id));
	const remove = panelRoles.filter((id) => held.has(id) && !picked.has(id));
	switch (mode) {
		case 'normal':
		case 'unique':
			return { add, remove };
		case 'verify':
			return { add, remove: [] };
		case 'drop':
			return { add: [], remove: [...picked].filter((id) => held.has(id)) };
	}
}

/** The member's roles after a change, for a single `roles.set` call. */
export function applyChange(held: Iterable<string>, change: RoleChange): string[] {
	const next = new Set(held);
	for (const id of change.remove) next.delete(id);
	for (const id of change.add) next.add(id);
	return [...next];
}

export function isNoChange(change: RoleChange): boolean {
	return change.add.length === 0 && change.remove.length === 0;
}

// ---------------------------------------------------------------------------------------------
// Which roles may be self-assigned
// ---------------------------------------------------------------------------------------------

/** Handing any of these out through a public panel or on join would be a privilege escalation. */
export const DANGEROUS_PERMISSIONS: readonly [bigint, string][] = [
	[PermissionFlagsBits.Administrator, 'Administrator'],
	[PermissionFlagsBits.ManageGuild, 'Manage Server'],
	[PermissionFlagsBits.ManageRoles, 'Manage Roles'],
	[PermissionFlagsBits.ManageChannels, 'Manage Channels'],
	[PermissionFlagsBits.ManageWebhooks, 'Manage Webhooks'],
	[PermissionFlagsBits.ManageMessages, 'Manage Messages'],
	[PermissionFlagsBits.ManageNicknames, 'Manage Nicknames'],
	[PermissionFlagsBits.ManageGuildExpressions, 'Manage Expressions'],
	[PermissionFlagsBits.ManageEvents, 'Manage Events'],
	[PermissionFlagsBits.ManageThreads, 'Manage Threads'],
	[PermissionFlagsBits.KickMembers, 'Kick Members'],
	[PermissionFlagsBits.BanMembers, 'Ban Members'],
	[PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
	[PermissionFlagsBits.MentionEveryone, 'Mention @everyone'],
	[PermissionFlagsBits.ViewAuditLog, 'View Audit Log'],
	[PermissionFlagsBits.MoveMembers, 'Move Members'],
	[PermissionFlagsBits.MuteMembers, 'Mute Members'],
	[PermissionFlagsBits.DeafenMembers, 'Deafen Members']
];

export interface RoleFacts {
	id: string;
	guildId: string;
	position: number;
	managed: boolean;
	permissions: bigint;
}

/**
 * Why a role can't be given out by a panel or auto-role, or null if it can. `botHighest` is the
 * position of Lyra's top role. Sticky roles skip the permission check (`checkPermissions: false`):
 * the member already held the role, so putting it back grants nothing new.
 */
export function selfRoleProblem(role: RoleFacts, botHighest: number, checkPermissions = true): string | null {
	if (role.id === role.guildId) return "that's @everyone, everybody already has it.";
	if (role.managed) return 'that role is managed by an integration, so nobody can assign it by hand.';
	if (role.position >= botHighest) return 'that role is equal to or above my top role, so Discord won’t let me.';
	if (checkPermissions) {
		const risky = DANGEROUS_PERMISSIONS.filter(([bit]) => (role.permissions & bit) === bit).map(([, name]) => name);
		if (risky.length) return `that role has moderator permissions (${risky.join(', ')}), so it can't be self-assigned or auto-given.`;
	}
	return null;
}

// ---------------------------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------------------------

export interface ParsedEmoji {
	/** As typed, for display: `🎮` or `<:pog:123>`. */
	text: string;
	/** What a reaction is matched on: the custom emoji ID, or the unicode emoji without variation selectors. */
	key: string;
	/** Set for custom emoji. */
	id: string | null;
	name: string;
	animated: boolean;
}

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const UNICODE_EMOJI =
	/^(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}️?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?)*)$/u;

export function normaliseEmojiKey(text: string): string {
	return text.replace(/️/g, '');
}

/** A single unicode emoji or a custom `<:name:id>` emoji, or null for anything else. */
export function parseEmoji(input: string | null | undefined): ParsedEmoji | null {
	const text = input?.trim();
	if (!text) return null;
	const custom = text.match(CUSTOM_EMOJI);
	if (custom) return { text, key: custom[3], id: custom[3], name: custom[2], animated: custom[1] === 'a' };
	if (UNICODE_EMOJI.test(text)) return { text, key: normaliseEmojiKey(text), id: null, name: text, animated: false };
	return null;
}

/** The key a live reaction matches against: custom emoji by ID, unicode by its normalised name. */
export function reactionKey(emoji: { id: string | null; name: string | null }): string | null {
	if (emoji.id) return emoji.id;
	return emoji.name ? normaliseEmojiKey(emoji.name) : null;
}

const MESSAGE_LINK = /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/;

/** A message link → its channel and message IDs. */
export function parseMessageLink(text: string | null | undefined): { channelId: string; messageId: string } | null {
	const match = text?.trim().match(MESSAGE_LINK);
	return match ? { channelId: match[2], messageId: match[3] } : null;
}

// ---------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------

export interface RolePanel {
	id: number;
	guild_id: string;
	channel_id: string;
	message_id: string;
	kind: PanelKind;
	mode: PanelMode;
	title: string | null;
	description: string | null;
	/** 1 when Lyra posted the message and may edit it. */
	owned: number;
	created_by: string;
	created_at: string;
}

export interface RolePanelEntry {
	panel_id: number;
	role_id: string;
	emoji: string | null;
	emoji_key: string | null;
	label: string | null;
	position: number;
}

export interface NewRolePanel {
	guildId: string;
	channelId: string;
	messageId: string;
	kind: PanelKind;
	mode: PanelMode;
	title?: string | null;
	description?: string | null;
	owned: boolean;
	createdBy: string;
	now?: Date;
}

export function createPanel(input: NewRolePanel): RolePanel {
	const result = db
		.prepare(
			`INSERT INTO role_panels (guild_id, channel_id, message_id, kind, mode, title, description, owned, created_by, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.guildId,
			input.channelId,
			input.messageId,
			input.kind,
			input.mode,
			input.title?.slice(0, MAX_TITLE_LENGTH) ?? null,
			input.description?.slice(0, MAX_DESCRIPTION_LENGTH) ?? null,
			input.owned ? 1 : 0,
			input.createdBy,
			(input.now ?? new Date()).toISOString()
		);
	return getPanel(input.guildId, Number(result.lastInsertRowid))!;
}

export function getPanel(guildId: string, panelId: number): RolePanel | null {
	return (db.prepare(`SELECT * FROM role_panels WHERE guild_id = ? AND id = ?`).get(guildId, panelId) as RolePanel | undefined) ?? null;
}

export function getPanelByMessage(messageId: string): RolePanel | null {
	return (db.prepare(`SELECT * FROM role_panels WHERE message_id = ?`).get(messageId) as RolePanel | undefined) ?? null;
}

export function getPanels(guildId: string): RolePanel[] {
	return db.prepare(`SELECT * FROM role_panels WHERE guild_id = ? ORDER BY id`).all(guildId) as RolePanel[];
}

export function countPanels(guildId: string): number {
	return (db.prepare(`SELECT COUNT(*) AS n FROM role_panels WHERE guild_id = ?`).get(guildId) as { n: number }).n;
}

export function setPanelMode(guildId: string, panelId: number, mode: PanelMode): boolean {
	return db.prepare(`UPDATE role_panels SET mode = ? WHERE guild_id = ? AND id = ?`).run(mode, guildId, panelId).changes > 0;
}

const deletePanelTx = db.transaction((guildId: string, panelId: number): boolean => {
	const removed = db.prepare(`DELETE FROM role_panels WHERE guild_id = ? AND id = ?`).run(guildId, panelId).changes > 0;
	if (removed) db.prepare(`DELETE FROM role_panel_entries WHERE panel_id = ?`).run(panelId);
	return removed;
});

export function deletePanel(guildId: string, panelId: number): boolean {
	return deletePanelTx(guildId, panelId);
}

export function getEntries(panelId: number): RolePanelEntry[] {
	return db.prepare(`SELECT * FROM role_panel_entries WHERE panel_id = ? ORDER BY position, role_id`).all(panelId) as RolePanelEntry[];
}

export interface NewEntry {
	roleId: string;
	emoji?: ParsedEmoji | null;
	label?: string | null;
}

/**
 * Adds a role to a panel, or updates its emoji/label if it's already there. Throws a plain
 * Error with a user-facing message when the panel is full or the emoji is taken.
 */
export function upsertEntry(panel: RolePanel, entry: NewEntry): RolePanelEntry {
	const entries = getEntries(panel.id);
	const existing = entries.find((row) => row.role_id === entry.roleId);
	if (!existing && entries.length >= MAX_ENTRIES[panel.kind]) {
		throw new Error(`that panel is full (${MAX_ENTRIES[panel.kind]} roles max for a ${panel.kind} panel).`);
	}
	const emoji = entry.emoji ?? null;
	if (emoji && entries.some((row) => row.role_id !== entry.roleId && row.emoji_key === emoji.key)) {
		throw new Error(`${emoji.text} is already used for another role on that panel.`);
	}
	const label = entry.label?.trim() ? entry.label.trim().slice(0, MAX_LABEL_LENGTH) : null;
	const position = existing?.position ?? (entries.length ? Math.max(...entries.map((row) => row.position)) + 1 : 0);
	db.prepare(
		`INSERT INTO role_panel_entries (panel_id, role_id, emoji, emoji_key, label, position) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(panel_id, role_id) DO UPDATE SET emoji = excluded.emoji, emoji_key = excluded.emoji_key, label = excluded.label`
	).run(panel.id, entry.roleId, emoji?.text ?? null, emoji?.key ?? null, label, position);
	return { panel_id: panel.id, role_id: entry.roleId, emoji: emoji?.text ?? null, emoji_key: emoji?.key ?? null, label, position };
}

export function removeEntry(panelId: number, roleId: string): RolePanelEntry | null {
	const row = db.prepare(`SELECT * FROM role_panel_entries WHERE panel_id = ? AND role_id = ?`).get(panelId, roleId) as RolePanelEntry | undefined;
	if (!row) return null;
	db.prepare(`DELETE FROM role_panel_entries WHERE panel_id = ? AND role_id = ?`).run(panelId, roleId);
	return row;
}

export function findEntryByEmoji(panelId: number, key: string): RolePanelEntry | null {
	return (
		(db.prepare(`SELECT * FROM role_panel_entries WHERE panel_id = ? AND emoji_key = ?`).get(panelId, key) as RolePanelEntry | undefined) ?? null
	);
}

/** Drops a deleted role from every panel in the guild. Returns the panels that changed. */
export function forgetRoleInPanels(guildId: string, roleId: string): number[] {
	const panels = (
		db
			.prepare(
				`SELECT DISTINCT e.panel_id FROM role_panel_entries e JOIN role_panels p ON p.id = e.panel_id WHERE p.guild_id = ? AND e.role_id = ?`
			)
			.all(guildId, roleId) as { panel_id: number }[]
	).map((row) => row.panel_id);
	for (const panelId of panels) db.prepare(`DELETE FROM role_panel_entries WHERE panel_id = ? AND role_id = ?`).run(panelId, roleId);
	return panels;
}

// Custom IDs carry the panel (and, for buttons, the role); both are re-checked against the database on use.
export const CUSTOM_ID_PREFIX = 'selfrole';

export function buttonCustomId(panelId: number, roleId: string): string {
	return `${CUSTOM_ID_PREFIX}:${panelId}:${roleId}`;
}

export function selectCustomId(panelId: number): string {
	return `${CUSTOM_ID_PREFIX}:${panelId}`;
}

export function parseCustomId(customId: string): { panelId: number; roleId: string | null } | null {
	const match = customId.match(/^selfrole:(\d{1,10})(?::(\d{17,20}))?$/);
	if (!match) return null;
	return { panelId: Number(match[1]), roleId: match[2] ?? null };
}

// ---------------------------------------------------------------------------------------------
// Auto-role
// ---------------------------------------------------------------------------------------------

export type AutoRoleTarget = 'human' | 'bot';

export function isAutoRoleTarget(value: string): value is AutoRoleTarget {
	return value === 'human' || value === 'bot';
}

export function getAutoRoles(guildId: string, target: AutoRoleTarget): string[] {
	return (
		db.prepare(`SELECT role_id FROM auto_roles WHERE guild_id = ? AND target = ? ORDER BY role_id`).all(guildId, target) as { role_id: string }[]
	).map((row) => row.role_id);
}

export function addAutoRole(guildId: string, roleId: string, target: AutoRoleTarget): boolean {
	return db.prepare(`INSERT OR IGNORE INTO auto_roles (guild_id, role_id, target) VALUES (?, ?, ?)`).run(guildId, roleId, target).changes > 0;
}

export function removeAutoRole(guildId: string, roleId: string, target: AutoRoleTarget): boolean {
	return db.prepare(`DELETE FROM auto_roles WHERE guild_id = ? AND role_id = ? AND target = ?`).run(guildId, roleId, target).changes > 0;
}

/** Limit per target, so a join can't turn into dozens of role edits. */
export const MAX_AUTO_ROLES = 10;

// ---------------------------------------------------------------------------------------------
// Sticky roles
// ---------------------------------------------------------------------------------------------

export const MAX_STICKY_ROLES = 25;

export function getStickyRoles(guildId: string): string[] {
	return (db.prepare(`SELECT role_id FROM sticky_role_config WHERE guild_id = ? ORDER BY role_id`).all(guildId) as { role_id: string }[]).map(
		(row) => row.role_id
	);
}

export function addStickyRole(guildId: string, roleId: string): boolean {
	return db.prepare(`INSERT OR IGNORE INTO sticky_role_config (guild_id, role_id) VALUES (?, ?)`).run(guildId, roleId).changes > 0;
}

export function removeStickyRole(guildId: string, roleId: string): boolean {
	return db.prepare(`DELETE FROM sticky_role_config WHERE guild_id = ? AND role_id = ?`).run(guildId, roleId).changes > 0;
}

/** Guilds with at least one sticky role, whose member lists are worth caching at startup. */
export function guildsWithStickyRoles(): string[] {
	return (db.prepare(`SELECT DISTINCT guild_id FROM sticky_role_config`).all() as { guild_id: string }[]).map((row) => row.guild_id);
}

/** Remembers the sticky roles a departing member held (or forgets them if they held none). */
export function saveStickyHold(guildId: string, userId: string, heldRoleIds: Iterable<string>, now = new Date()): string[] {
	const sticky = new Set(getStickyRoles(guildId));
	const keep = [...new Set(heldRoleIds)].filter((id) => sticky.has(id)).sort();
	if (keep.length === 0) {
		db.prepare(`DELETE FROM sticky_role_holds WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
		return [];
	}
	db.prepare(
		`INSERT INTO sticky_role_holds (guild_id, user_id, role_ids, saved_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(guild_id, user_id) DO UPDATE SET role_ids = excluded.role_ids, saved_at = excluded.saved_at`
	).run(guildId, userId, JSON.stringify(keep), now.toISOString());
	return keep;
}

function parseHold(raw: string): string[] {
	try {
		const value = JSON.parse(raw) as unknown;
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** The saved roles for a returning member that are still sticky, without clearing them. */
export function peekStickyHold(guildId: string, userId: string): string[] {
	const row = db.prepare(`SELECT role_ids FROM sticky_role_holds WHERE guild_id = ? AND user_id = ?`).get(guildId, userId) as
		{ role_ids: string } | undefined;
	if (!row) return [];
	const sticky = new Set(getStickyRoles(guildId));
	return parseHold(row.role_ids).filter((id) => sticky.has(id));
}

export function clearStickyHold(guildId: string, userId: string): void {
	db.prepare(`DELETE FROM sticky_role_holds WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
}

/**
 * Drops one role from a departed member's saved set, e.g. when a timed role expires while
 * they're away, so rejoining doesn't bring back a role that should have run out.
 */
export function forgetStickyRole(guildId: string, userId: string, roleId: string): void {
	const row = db.prepare(`SELECT role_ids FROM sticky_role_holds WHERE guild_id = ? AND user_id = ?`).get(guildId, userId) as
		{ role_ids: string } | undefined;
	if (!row) return;
	const rest = parseHold(row.role_ids).filter((id) => id !== roleId);
	if (rest.length === 0) clearStickyHold(guildId, userId);
	else db.prepare(`UPDATE sticky_role_holds SET role_ids = ? WHERE guild_id = ? AND user_id = ?`).run(JSON.stringify(rest), guildId, userId);
}

/** A deleted role is removed from the auto-role and sticky lists. */
export function forgetRoleInConfig(guildId: string, roleId: string): void {
	db.prepare(`DELETE FROM auto_roles WHERE guild_id = ? AND role_id = ?`).run(guildId, roleId);
	db.prepare(`DELETE FROM sticky_role_config WHERE guild_id = ? AND role_id = ?`).run(guildId, roleId);
}
