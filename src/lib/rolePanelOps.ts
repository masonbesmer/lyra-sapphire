import type { Guild, GuildMember, Role } from 'discord.js';
import { recordConfigChange, type AuditActor } from './audit';
import { ModError } from './modActions';
import { assertSelfAssignable, buildPanelEmbed, missingPanelPermissions, refreshPanel, removePanelReaction, tearDownPanel } from './selfRoleActions';
import {
	MAX_PANELS_PER_GUILD,
	countPanels,
	createPanel,
	deletePanel,
	getEntries,
	getPanel,
	getPanelByMessage,
	parseEmoji,
	removeEntry,
	setPanelMode,
	upsertEntry,
	type PanelKind,
	type PanelMode,
	type RolePanel,
	type RolePanelEntry
} from './selfRoles';

/**
 * Role-panel changes that touch Discord, shared by `/roles panel` and the dashboard's reaction-role
 * builder (LYRA-13) so both validate and render the same way. Each throws a ModError with a
 * message fit to show the moderator. Every change lands in the config audit log.
 */

function describePanel(panel: RolePanel, entries: RolePanelEntry[] = getEntries(panel.id)): string {
	const roles = entries.map((entry) => `${entry.emoji ? `${entry.emoji} ` : ''}${entry.role_id}`).join(', ');
	return `${panel.kind}, ${panel.mode}${panel.title ? `, "${panel.title}"` : ''}: ${roles || 'no roles'}`;
}

function auditPanel(guildId: string, actor: AuditActor, panelId: number, before: string | null, after: string | null): void {
	recordConfigChange(guildId, actor, 'moderation', `role_panel.${panelId}`, before, after);
}

export function requirePanel(guildId: string, panelId: number | null | undefined): RolePanel {
	const panel = panelId ? getPanel(guildId, panelId) : null;
	if (!panel) throw new ModError(`there's no panel #${panelId ?? '?'} here. \`/roles panel list\` shows them.`);
	return panel;
}

export interface CreatePanelInput {
	kind: PanelKind;
	mode: PanelMode;
	channelId: string | null;
	/** Set to turn an existing message into a reaction panel instead of posting a new one. */
	messageId?: string | null;
	title?: string | null;
	description?: string | null;
}

/** Posts a new panel (or adopts an existing message for a reaction panel). Returns the panel and its message link. */
export async function createRolePanel(
	guild: Guild,
	moderator: GuildMember,
	actor: AuditActor,
	input: CreatePanelInput
): Promise<{ panel: RolePanel; url: string; adopted: boolean }> {
	const { kind, mode } = input;
	if (countPanels(guild.id) >= MAX_PANELS_PER_GUILD)
		throw new ModError(`this server already has ${MAX_PANELS_PER_GUILD} panels. delete one first.`);
	const channel = input.channelId ? guild.channels.cache.get(input.channelId) : null;
	if (!channel?.isTextBased() || channel.isDMBased()) throw new ModError("I can't use that channel.");
	const existing = input.messageId !== null && input.messageId !== undefined;
	if (existing && kind !== 'reaction')
		throw new ModError('only reaction panels can use an existing message. buttons and menus need a message I post.');
	const missing = missingPanelPermissions(guild, channel.id, kind, !existing);
	if (missing.length) throw new ModError(`I need ${missing.join(', ')} in <#${channel.id}>.`);

	if (existing) {
		const target = await channel.messages.fetch(input.messageId!).catch(() => null);
		if (!target) throw new ModError("I can't find that message.");
		if (getPanelByMessage(target.id)) throw new ModError('that message is already a role panel.');
		const panel = createPanel({
			guildId: guild.id,
			channelId: channel.id,
			messageId: target.id,
			kind,
			mode,
			owned: false,
			createdBy: moderator.id
		});
		auditPanel(guild.id, actor, panel.id, null, describePanel(panel, []));
		return { panel, url: target.url, adopted: true };
	}

	const draft = { id: 0, kind, mode, title: input.title ?? null, description: input.description ?? null } as RolePanel;
	const sent = await channel.send({ embeds: [buildPanelEmbed(draft, [])], allowedMentions: { parse: [] } });
	let panel: RolePanel;
	try {
		panel = createPanel({
			guildId: guild.id,
			channelId: channel.id,
			messageId: sent.id,
			kind,
			mode,
			title: input.title,
			description: input.description,
			owned: true,
			createdBy: moderator.id
		});
	} catch (error) {
		await sent.delete().catch(() => undefined);
		throw error;
	}
	// Re-render now the panel has its number for the footer.
	await refreshPanel(guild, panel).catch(() => undefined);
	auditPanel(guild.id, actor, panel.id, null, describePanel(panel, []));
	return { panel, url: sent.url, adopted: false };
}

/** Adds a role to a panel or updates its emoji/label, then re-renders. Rolls back if the message can't be updated. */
export async function addPanelRole(
	guild: Guild,
	moderator: GuildMember,
	actor: AuditActor,
	panel: RolePanel,
	role: Role,
	emojiText: string | null,
	label: string | null
): Promise<{ previous: RolePanelEntry | null; emoji: ReturnType<typeof parseEmoji> }> {
	await assertSelfAssignable(moderator, role);
	const emoji = emojiText ? parseEmoji(emojiText) : null;
	if (emojiText && !emoji) throw new ModError(`"${emojiText}" isn't an emoji I can use. Use one emoji, or a custom one like <:name:id>.`);
	if (panel.kind === 'reaction' && !emoji) throw new ModError('reaction panels need an emoji for each role.');
	const before = describePanel(panel);
	const previous = getEntries(panel.id).find((entry) => entry.role_id === role.id) ?? null;
	try {
		upsertEntry(panel, { roleId: role.id, emoji, label });
	} catch (error) {
		throw new ModError(error instanceof Error ? error.message : String(error));
	}
	try {
		await refreshPanel(guild, panel);
	} catch (error) {
		// Put the panel back how it was, so the stored entries match the message.
		if (previous) upsertEntry(panel, { roleId: role.id, emoji: parseEmoji(previous.emoji), label: previous.label });
		else removeEntry(panel.id, role.id);
		await refreshPanel(guild, panel).catch(() => undefined);
		throw error;
	}
	if (previous?.emoji_key && previous.emoji_key !== emoji?.key) await removePanelReaction(guild, panel, previous.emoji_key);
	auditPanel(guild.id, actor, panel.id, before, describePanel(panel));
	return { previous, emoji };
}

export async function removePanelRole(guild: Guild, actor: AuditActor, panel: RolePanel, roleId: string): Promise<void> {
	const before = describePanel(panel);
	const removed = removeEntry(panel.id, roleId);
	if (!removed) throw new ModError(`<@&${roleId}> isn't on panel #${panel.id}.`);
	await refreshPanel(guild, panel).catch(() => undefined);
	await removePanelReaction(guild, panel, removed.emoji_key);
	auditPanel(guild.id, actor, panel.id, before, describePanel(panel));
}

export async function changePanelMode(guild: Guild, actor: AuditActor, panel: RolePanel, mode: PanelMode): Promise<RolePanel> {
	const before = describePanel(panel);
	setPanelMode(guild.id, panel.id, mode);
	const updated = { ...panel, mode };
	await refreshPanel(guild, updated).catch(() => undefined);
	auditPanel(guild.id, actor, panel.id, before, describePanel(updated));
	return updated;
}

export async function deleteRolePanel(guild: Guild, actor: AuditActor, panel: RolePanel): Promise<void> {
	const before = describePanel(panel);
	await tearDownPanel(guild, panel);
	deletePanel(guild.id, panel.id);
	auditPanel(guild.id, actor, panel.id, before, null);
}
