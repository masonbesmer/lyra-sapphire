import { container } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	type ButtonInteraction,
	type Client,
	type Guild,
	type GuildMember,
	type MessageActionRowComponentBuilder,
	type MessageReaction,
	type PartialGuildMember,
	type PartialMessageReaction,
	type PartialUser,
	type Role,
	type StringSelectMenuInteraction,
	type User
} from 'discord.js';
import { getAntiRaidConfig, holdsAutoRoles } from './antiRaid';
import { ModError, assertCanManageRole, fetchMember, recordCase } from './modActions';
import {
	MODE_HINTS,
	findEntryByEmoji,
	getAutoRoles,
	getEntries,
	getPanel,
	getPanelByMessage,
	clearStickyHold,
	guildsWithStickyRoles,
	isNoChange,
	parseCustomId,
	parseEmoji,
	peekStickyHold,
	reactionKey,
	resolveSelection,
	resolveToggle,
	saveStickyHold,
	selfRoleProblem,
	buttonCustomId,
	selectCustomId,
	type RoleChange,
	type RolePanel,
	type RolePanelEntry,
	type ToggleEvent
} from './selfRoles';

/** The Discord side of self-assign roles: rendering panels, handling clicks and reactions, joins and leaves. */

async function botHighest(guild: Guild): Promise<number> {
	const me = guild.members.me ?? (await guild.members.fetchMe());
	return me.roles.highest.position;
}

function factsOf(role: Role) {
	return { id: role.id, guildId: role.guild.id, position: role.position, managed: role.managed, permissions: role.permissions.bitfield };
}

/**
 * Throws a ModError unless `moderator` may put `role` on a panel or the auto-role list: the usual
 * hierarchy rules, plus no moderator permissions on the role (skipped for sticky roles).
 */
export async function assertSelfAssignable(moderator: GuildMember, role: Role, checkPermissions = true): Promise<void> {
	await assertCanManageRole(moderator, role);
	const problem = selfRoleProblem(factsOf(role), await botHighest(moderator.guild), checkPermissions);
	if (problem) throw new ModError(problem);
}

/** Splits a change into the roles Lyra can still hand out right now and the ones she can't. */
async function usableChange(guild: Guild, change: RoleChange): Promise<{ change: RoleChange; skipped: string[] }> {
	const highest = await botHighest(guild);
	const skipped: string[] = [];
	const ok = (id: string) => {
		const role = guild.roles.cache.get(id);
		if (!role || selfRoleProblem(factsOf(role), highest)) {
			skipped.push(id);
			return false;
		}
		return true;
	};
	return { change: { add: change.add.filter(ok), remove: change.remove.filter(ok) }, skipped };
}

async function applyChange(member: GuildMember, change: RoleChange, reason: string): Promise<void> {
	if (change.remove.length) await member.roles.remove(change.remove, reason);
	if (change.add.length) await member.roles.add(change.add, reason);
}

export function describeChange(change: RoleChange, skipped: string[] = []): string {
	const lines: string[] = [];
	if (change.add.length) lines.push(`➕ ${change.add.map((id) => `<@&${id}>`).join(', ')}`);
	if (change.remove.length) lines.push(`➖ ${change.remove.map((id) => `<@&${id}>`).join(', ')}`);
	if (!lines.length) lines.push('nothing to change.');
	if (skipped.length) lines.push(`-# skipped ${skipped.map((id) => `<@&${id}>`).join(', ')}: I can't hand that out any more, tell a mod.`);
	return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function entryLabel(guild: Guild, entry: RolePanelEntry): string {
	return (entry.label ?? guild.roles.cache.get(entry.role_id)?.name ?? 'deleted role').slice(0, 80);
}

function emojiOption(text: string | null): { id: string; name: string; animated: boolean } | string | undefined {
	const parsed = parseEmoji(text);
	if (!parsed) return undefined;
	return parsed.id ? { id: parsed.id, name: parsed.name, animated: parsed.animated } : parsed.text;
}

export function buildPanelEmbed(panel: RolePanel, entries: RolePanelEntry[]): EmbedBuilder {
	const lines = entries.map((entry) => `${entry.emoji ? `${entry.emoji} ` : '• '}<@&${entry.role_id}>${entry.label ? ` — ${entry.label}` : ''}`);
	const body = [panel.description, lines.length ? lines.join('\n') : '_No roles yet. A mod can add some with `/roles panel add`._']
		.filter(Boolean)
		.join('\n\n');
	const how = panel.kind === 'reaction' ? 'React below.' : panel.kind === 'select' ? 'Use the menu below.' : 'Press a button below.';
	return new EmbedBuilder()
		.setColor(Colors.Blurple)
		.setTitle(panel.title ?? 'Pick your roles')
		.setDescription(body.slice(0, 4096))
		.setFooter({ text: `${how} ${MODE_HINTS[panel.mode]} · Panel #${panel.id}`.slice(0, 2048) });
}

export function buildPanelComponents(
	guild: Guild,
	panel: RolePanel,
	entries: RolePanelEntry[]
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
	if (panel.kind === 'reaction' || entries.length === 0) return [];
	if (panel.kind === 'select') {
		const multi = panel.mode === 'normal' || panel.mode === 'verify' || panel.mode === 'drop';
		const menu = new StringSelectMenuBuilder()
			.setCustomId(selectCustomId(panel.id))
			.setPlaceholder(panel.mode === 'drop' ? 'Pick roles to remove' : 'Pick your roles')
			// Normal and unique panels treat the selection as the wanted set, so an empty pick clears it.
			.setMinValues(panel.mode === 'normal' || panel.mode === 'unique' ? 0 : 1)
			.setMaxValues(multi ? entries.length : 1)
			.addOptions(
				entries.map((entry) => {
					const option = new StringSelectMenuOptionBuilder().setLabel(entryLabel(guild, entry)).setValue(entry.role_id);
					const emoji = emojiOption(entry.emoji);
					if (emoji) option.setEmoji(emoji);
					return option;
				})
			);
		return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)];
	}
	const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
	entries.forEach((entry, index) => {
		if (index % 5 === 0) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>());
		const button = new ButtonBuilder()
			.setCustomId(buttonCustomId(panel.id, entry.role_id))
			.setLabel(entryLabel(guild, entry))
			.setStyle(ButtonStyle.Secondary);
		const emoji = emojiOption(entry.emoji);
		if (emoji) button.setEmoji(emoji);
		rows[rows.length - 1].addComponents(button);
	});
	return rows;
}

async function fetchPanelMessage(guild: Guild, panel: RolePanel) {
	const channel = guild.channels.cache.get(panel.channel_id) ?? (await guild.channels.fetch(panel.channel_id).catch(() => null));
	if (!channel?.isTextBased()) return null;
	return channel.messages.fetch(panel.message_id).catch(() => null);
}

/**
 * Brings a panel's message up to date: re-renders a message Lyra owns and, for reaction panels,
 * makes sure each emoji has her reaction for people to click. Throws a ModError if the message is gone.
 */
export async function refreshPanel(guild: Guild, panel: RolePanel): Promise<void> {
	const message = await fetchPanelMessage(guild, panel);
	if (!message) throw new ModError(`I can't find panel #${panel.id}'s message any more. delete the panel with \`/roles panel delete\`.`);
	const entries = getEntries(panel.id);
	if (panel.owned) {
		await message.edit({
			embeds: [buildPanelEmbed(panel, entries)],
			components: buildPanelComponents(guild, panel, entries),
			allowedMentions: { parse: [] }
		});
	}
	if (panel.kind === 'reaction') {
		for (const entry of entries) {
			if (!entry.emoji) continue;
			const existing = message.reactions.cache.find((reaction) => reactionKey(reaction.emoji) === entry.emoji_key);
			if (existing?.me) continue;
			try {
				await message.react(entry.emoji);
			} catch {
				throw new ModError(
					`I couldn't react with ${entry.emoji}. Is it an emoji I can use, and can I add reactions in <#${panel.channel_id}>?`
				);
			}
		}
	}
}

/** Removes Lyra's reaction for an emoji that left a reaction panel. Best-effort. */
export async function removePanelReaction(guild: Guild, panel: RolePanel, emojiKey: string | null): Promise<void> {
	if (panel.kind !== 'reaction' || !emojiKey) return;
	const message = await fetchPanelMessage(guild, panel);
	const reaction = message?.reactions.cache.find((entry) => reactionKey(entry.emoji) === emojiKey);
	await reaction?.users.remove(guild.client.user.id).catch(() => undefined);
}

/** Deletes a panel's message if Lyra posted it, otherwise just takes her reactions off. Best-effort. */
export async function tearDownPanel(guild: Guild, panel: RolePanel): Promise<void> {
	const message = await fetchPanelMessage(guild, panel);
	if (!message) return;
	if (panel.owned) {
		await message.delete().catch(() => undefined);
		return;
	}
	for (const reaction of message.reactions.cache.values()) {
		if (reaction.me) await reaction.users.remove(guild.client.user.id).catch(() => undefined);
	}
}

// ---------------------------------------------------------------------------------------------
// Buttons and select menus
// ---------------------------------------------------------------------------------------------

function panelRoleIds(entries: RolePanelEntry[]): string[] {
	return entries.map((entry) => entry.role_id);
}

/** Handles a click on a role-panel button or a submitted role-panel menu. Returns false if it wasn't one. */
export async function handlePanelInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean> {
	const parsed = parseCustomId(interaction.customId);
	if (!parsed) return false;
	if (!interaction.inCachedGuild()) return true;

	// Role edits can outlast Discord's 3-second window, so acknowledge first.
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	const reply = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });
	const panel = getPanel(interaction.guildId, parsed.panelId);
	// The IDs in the component are only a hint: the panel has to exist and be this message.
	if (!panel || panel.message_id !== interaction.message.id) {
		await reply("this role panel isn't set up any more.");
		return true;
	}
	const entries = getEntries(panel.id);
	const roles = panelRoleIds(entries);
	const held = new Set(interaction.member.roles.cache.keys());

	let wanted: RoleChange;
	if (interaction.isButton()) {
		if (!parsed.roleId || !roles.includes(parsed.roleId)) {
			await reply("that role isn't on this panel any more.");
			return true;
		}
		wanted = resolveToggle(panel.mode, roles, held, parsed.roleId, 'click');
	} else {
		wanted = resolveSelection(panel.mode, roles, held, interaction.values);
	}

	if (isNoChange(wanted)) {
		await reply(panel.mode === 'verify' ? "you already have that, and this panel can't take it away." : 'nothing to change.');
		return true;
	}
	const { change, skipped } = await usableChange(interaction.guild, wanted);
	try {
		await applyChange(interaction.member, change, `Role panel #${panel.id}`);
	} catch (error) {
		container.logger.warn(`[selfroles] panel #${panel.id} couldn't update ${interaction.user.id}: ${String(error)}`);
		await reply("Discord wouldn't let me change your roles. tell a mod.");
		return true;
	}
	await reply(describeChange(change, skipped));
	return true;
}

// ---------------------------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------------------------

/** Handles a reaction added to or removed from a reaction panel. */
export async function handlePanelReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
	event: Extract<ToggleEvent, 'react' | 'unreact'>
): Promise<void> {
	if (user.bot) return;
	const panel = getPanelByMessage(reaction.message.id);
	if (!panel || panel.kind !== 'reaction') return;
	const key = reactionKey(reaction.emoji);
	const entry = key ? findEntryByEmoji(panel.id, key) : null;
	if (!entry) return;

	const guild = container.client.guilds.cache.get(panel.guild_id);
	if (!guild) return;
	const member = await fetchMember(guild, user.id).catch(() => null);
	if (!member) return;

	const entries = getEntries(panel.id);
	const wanted = resolveToggle(panel.mode, panelRoleIds(entries), new Set(member.roles.cache.keys()), entry.role_id, event);
	if (isNoChange(wanted)) return;
	const { change, skipped } = await usableChange(guild, wanted);
	if (skipped.length) container.logger.warn(`[selfroles] panel #${panel.id} skipped roles Lyra can't assign: ${skipped.join(', ')}`);
	try {
		await applyChange(member, change, `Role panel #${panel.id}`);
	} catch (error) {
		container.logger.warn(`[selfroles] panel #${panel.id} couldn't update ${user.id}: ${String(error)}`);
		return;
	}

	// Unique panels: take the member's other reactions off so the message shows their one pick.
	if (panel.mode === 'unique' && event === 'react' && change.remove.length) {
		const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
		if (!message) return;
		const removedKeys = new Set(entries.filter((row) => change.remove.includes(row.role_id)).map((row) => row.emoji_key));
		for (const other of message.reactions.cache.values()) {
			if (removedKeys.has(reactionKey(other.emoji))) await other.users.remove(user.id).catch(() => undefined);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Joins and leaves
// ---------------------------------------------------------------------------------------------

async function assignable(guild: Guild, roleIds: string[], checkPermissions: boolean): Promise<string[]> {
	const highest = await botHighest(guild);
	return roleIds.filter((id) => {
		const role = guild.roles.cache.get(id);
		const problem = role ? selfRoleProblem(factsOf(role), highest, checkPermissions) : 'deleted';
		if (problem) container.logger.debug(`[selfroles] not assigning ${id} in ${guild.id}: ${problem}`);
		return !problem;
	});
}

/** Gives a new member the guild's auto-roles. Runs on join, or once membership screening is passed. */
export async function applyAutoRoles(member: GuildMember): Promise<string[]> {
	const roles = await assignable(member.guild, getAutoRoles(member.guild.id, member.user.bot ? 'bot' : 'human'), true);
	const missing = roles.filter((id) => !member.roles.cache.has(id));
	if (!missing.length) return [];
	await member.roles.add(missing, 'Auto-role on join');
	return missing;
}

/**
 * Puts a returning member's sticky roles back and records it as a case, so moderators can see
 * someone left and rejoined while muted. Runs even before membership screening is passed.
 */
export async function restoreStickyRoles(member: GuildMember): Promise<string[]> {
	const saved = peekStickyHold(member.guild.id, member.id);
	if (!saved.length) {
		clearStickyHold(member.guild.id, member.id);
		return [];
	}
	const roles = (await assignable(member.guild, saved, false)).filter((id) => !member.roles.cache.has(id));
	if (roles.length) {
		await member.roles.add(roles, 'Sticky roles restored on rejoin');
		await recordCase(
			member.guild,
			{
				action: 'role-add',
				targetId: member.id,
				targetTag: member.user.username,
				moderatorId: member.client.user.id,
				moderatorTag: member.client.user.username,
				reason: 'Sticky roles restored after leaving and rejoining'
			},
			[{ name: roles.length === 1 ? 'Role' : 'Roles', value: roles.map((id) => `<@&${id}>`).join(', ') }]
		);
	}
	clearStickyHold(member.guild.id, member.id);
	return roles;
}

export async function onMemberJoin(member: GuildMember): Promise<void> {
	try {
		await restoreStickyRoles(member);
	} catch (error) {
		container.logger.warn(`[selfroles] couldn't restore sticky roles for ${member.id} in ${member.guild.id}: ${String(error)}`);
	}
	// Members still on the rules screen get their auto-roles once they accept (guildMemberUpdate).
	if (member.pending || heldByAntiRaid(member)) return;
	try {
		await applyAutoRoles(member);
	} catch (error) {
		container.logger.warn(`[selfroles] couldn't give auto-roles to ${member.id} in ${member.guild.id}: ${String(error)}`);
	}
}

/** Anti-raid is quarantining or removing this member: auto-roles wait for verification (LYRA-12). */
function heldByAntiRaid(member: GuildMember): boolean {
	return holdsAutoRoles(getAntiRaidConfig(member.guild.id), {
		accountCreatedAt: member.user.createdTimestamp,
		hasDefaultAvatar: member.user.avatar === null,
		isBot: member.user.bot,
		roleIds: member.roles.cache.keys()
	});
}

export async function onMemberScreeningPassed(member: GuildMember): Promise<void> {
	if (heldByAntiRaid(member)) return;
	try {
		await applyAutoRoles(member);
	} catch (error) {
		container.logger.warn(`[selfroles] couldn't give auto-roles to ${member.id} in ${member.guild.id}: ${String(error)}`);
	}
}

export function onMemberLeave(member: GuildMember | PartialGuildMember): void {
	// A partial member carries no roles; saving it would wipe a hold saved on an earlier leave.
	if (member.partial) return;
	saveStickyHold(member.guild.id, member.id, member.roles.cache.keys());
}

/**
 * Sticky roles are read from the member cache when someone leaves, so guilds that use them get
 * their member list cached at startup.
 */
export async function warmStickyGuilds(client: Client): Promise<void> {
	for (const guildId of guildsWithStickyRoles()) {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) continue;
		await guild.members.fetch().catch((error) => container.logger.warn(`[selfroles] couldn't cache members of ${guildId}: ${String(error)}`));
	}
}

/** What the bot needs in a channel to post (or react on) a panel there. */
export function missingPanelPermissions(guild: Guild, channelId: string, kind: RolePanel['kind'], owned: boolean): string[] {
	const channel = guild.channels.cache.get(channelId);
	const me = guild.members.me;
	if (!channel || !me) return ['access to that channel'];
	const perms = channel.permissionsFor(me);
	const needed: [bigint, string][] = [
		[PermissionFlagsBits.ViewChannel, 'View Channel'],
		[PermissionFlagsBits.ReadMessageHistory, 'Read Message History']
	];
	if (owned) needed.push([PermissionFlagsBits.SendMessages, 'Send Messages'], [PermissionFlagsBits.EmbedLinks, 'Embed Links']);
	if (kind === 'reaction') needed.push([PermissionFlagsBits.AddReactions, 'Add Reactions']);
	return needed.filter(([bit]) => !perms?.has(bit)).map(([, name]) => name);
}
