import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message, type Role } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';
import {
	assertSelfAssignable,
	buildPanelEmbed,
	missingPanelPermissions,
	refreshPanel,
	removePanelReaction,
	tearDownPanel
} from '../../lib/selfRoleActions';
import {
	MAX_AUTO_ROLES,
	MAX_DESCRIPTION_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_PANELS_PER_GUILD,
	MAX_STICKY_ROLES,
	MAX_TITLE_LENGTH,
	MEMBERS_INTENT_HINT,
	addAutoRole,
	addStickyRole,
	countPanels,
	createPanel,
	deletePanel,
	getAutoRoles,
	getEntries,
	getPanel,
	getPanelByMessage,
	getPanels,
	getStickyRoles,
	isAutoRoleTarget,
	isPanelKind,
	isPanelMode,
	membersIntentEnabled,
	parseEmoji,
	parseMessageLink,
	removeAutoRole,
	removeEntry,
	removeStickyRole,
	setPanelMode,
	upsertEntry,
	type AutoRoleTarget,
	type PanelKind,
	type PanelMode,
	type RolePanel
} from '../../lib/selfRoles';

const USAGE = [
	'`%roles panel create <button|select|reaction> [mode] [#channel|message link] [title]`',
	'`%roles panel add <panel> @role [emoji] [label]`',
	'`%roles panel remove <panel> @role`',
	'`%roles panel mode <panel> <normal|unique|verify|drop>`',
	'`%roles panel list` | `%roles panel delete <panel>`',
	'`%roles autorole add|remove @role [humans|bots]` | `%roles autorole list`',
	'`%roles sticky add|remove @role` | `%roles sticky list`'
].join('\n');

const MODE_CHOICES = [
	{ name: 'normal: add and remove freely', value: 'normal' },
	{ name: 'unique: one role at a time', value: 'unique' },
	{ name: 'verify: add only', value: 'verify' },
	{ name: 'drop: remove only', value: 'drop' }
];
const KIND_CHOICES = [
	{ name: 'buttons', value: 'button' },
	{ name: 'select menu', value: 'select' },
	{ name: 'reactions', value: 'reaction' }
];
const TARGET_CHOICES = [
	{ name: 'humans', value: 'human' },
	{ name: 'bots', value: 'bot' }
];

/** Everything a subcommand might need, collected from either command style. */
interface Request {
	group: 'panel' | 'autorole' | 'sticky';
	sub: string;
	panelId?: number | null;
	kind?: PanelKind | null;
	mode?: PanelMode | null;
	channelId?: string | null;
	messageId?: string | null;
	title?: string | null;
	description?: string | null;
	role?: Role | null;
	emoji?: string | null;
	label?: string | null;
	target?: AutoRoleTarget;
}

@ApplyOptions<ModCommandOptions>({
	name: 'roles',
	description: 'Self-assign role panels, auto-role on join and sticky roles',
	permission: PermissionFlagsBits.ManageRoles
})
export class RolesCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommandGroup((group) =>
					group
						.setName('panel')
						.setDescription('Messages people use to give themselves roles')
						.addSubcommand((sub) =>
							sub
								.setName('create')
								.setDescription('Post a new role panel (or turn an existing message into a reaction panel)')
								.addStringOption((o) =>
									o
										.setName('kind')
										.setDescription('Buttons, a select menu or reactions')
										.setRequired(true)
										.addChoices(...KIND_CHOICES)
								)
								.addStringOption((o) =>
									o
										.setName('mode')
										.setDescription('How picking works (default normal)')
										.addChoices(...MODE_CHOICES)
								)
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Where to post it (default here)')
										.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
								)
								.addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(MAX_TITLE_LENGTH))
								.addStringOption((o) =>
									o.setName('description').setDescription('Text above the role list').setMaxLength(MAX_DESCRIPTION_LENGTH)
								)
								.addStringOption((o) =>
									o
										.setName('message')
										.setDescription('Reaction panels only: link to an existing message to use instead of posting one')
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add a role to a panel, or change its emoji/label')
								.addIntegerOption((o) => o.setName('panel').setDescription('Panel number').setRequired(true).setMinValue(1))
								.addRoleOption((o) => o.setName('role').setDescription('Role to hand out').setRequired(true))
								.addStringOption((o) => o.setName('emoji').setDescription('Emoji (required for reaction panels)'))
								.addStringOption((o) =>
									o.setName('label').setDescription('Button/menu text (default: the role name)').setMaxLength(MAX_LABEL_LENGTH)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Take a role off a panel')
								.addIntegerOption((o) => o.setName('panel').setDescription('Panel number').setRequired(true).setMinValue(1))
								.addRoleOption((o) => o.setName('role').setDescription('Role to take off').setRequired(true))
						)
						.addSubcommand((sub) =>
							sub
								.setName('mode')
								.setDescription("Change how a panel's picks work")
								.addIntegerOption((o) => o.setName('panel').setDescription('Panel number').setRequired(true).setMinValue(1))
								.addStringOption((o) =>
									o
										.setName('mode')
										.setDescription('New mode')
										.setRequired(true)
										.addChoices(...MODE_CHOICES)
								)
						)
						.addSubcommand((sub) => sub.setName('list').setDescription("This server's role panels"))
						.addSubcommand((sub) =>
							sub
								.setName('delete')
								.setDescription('Delete a panel (and its message, if Lyra posted it)')
								.addIntegerOption((o) => o.setName('panel').setDescription('Panel number').setRequired(true).setMinValue(1))
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('autorole')
						.setDescription('Roles given to everyone who joins')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Give this role on join')
								.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
								.addStringOption((o) =>
									o
										.setName('for')
										.setDescription('Humans or bots (default humans)')
										.addChoices(...TARGET_CHOICES)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Stop giving this role on join')
								.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
								.addStringOption((o) =>
									o
										.setName('for')
										.setDescription('Humans or bots (default humans)')
										.addChoices(...TARGET_CHOICES)
								)
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('Show the auto-roles'))
				)
				.addSubcommandGroup((group) =>
					group
						.setName('sticky')
						.setDescription('Roles that come back when someone leaves and rejoins')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Make a role sticky (e.g. a mute role)')
								.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Stop keeping this role across rejoins')
								.addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('Show the sticky roles'))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(
			interaction,
			() => {
				const ctx = contextOf(interaction);
				const roleId = interaction.options.getRole('role')?.id;
				const role = roleId ? (ctx.guild.roles.cache.get(roleId) ?? null) : null;
				if (roleId && !role) throw new ModError("couldn't find that role.");
				const link = interaction.options.getString('message');
				const parsedLink = link ? parseMessageLink(link) : null;
				if (link && !parsedLink) throw new ModError("that isn't a message link. right-click the message → Copy Message Link.");
				const target = interaction.options.getString('for') ?? 'human';
				return this.execute(ctx, {
					group: interaction.options.getSubcommandGroup(true) as Request['group'],
					sub: interaction.options.getSubcommand(true),
					panelId: interaction.options.getInteger('panel'),
					kind: interaction.options.getString('kind') as PanelKind | null,
					mode: interaction.options.getString('mode') as PanelMode | null,
					channelId: parsedLink?.channelId ?? interaction.options.getChannel('channel')?.id ?? interaction.channelId,
					messageId: parsedLink?.messageId ?? null,
					title: interaction.options.getString('title'),
					description: interaction.options.getString('description'),
					role,
					emoji: interaction.options.getString('emoji'),
					label: interaction.options.getString('label'),
					target: isAutoRoleTarget(target) ? target : 'human'
				});
			},
			{ defer: true, ephemeral: true }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => this.execute(contextOf(message), await this.parseMessage(message, args)));
	}

	private async parseMessage(message: Message, args: Args): Promise<Request> {
		const word = async () => (await args.pick('string').catch(() => '')).trim();
		const group = (await word()).toLowerCase();
		const sub = (await word()).toLowerCase();
		const pickRole = async () => {
			const role = await args.pick('role').catch(() => null);
			if (!role) usage(USAGE);
			return role;
		};
		const pickPanel = async () => {
			const id = Number((await word()).replace(/^#/, ''));
			if (!Number.isInteger(id) || id < 1) usage(USAGE);
			return id;
		};
		const rest = async () => (await args.rest('string').catch(() => '')).trim() || null;

		if (group === 'panel') {
			if (sub === 'list') return { group, sub };
			if (sub === 'delete') return { group, sub, panelId: await pickPanel() };
			if (sub === 'remove') return { group, sub, panelId: await pickPanel(), role: await pickRole() };
			if (sub === 'mode') {
				const panelId = await pickPanel();
				const mode = (await word()).toLowerCase();
				if (!isPanelMode(mode)) usage(USAGE);
				return { group, sub, panelId, mode };
			}
			if (sub === 'add') {
				const panelId = await pickPanel();
				const role = await pickRole();
				args.save();
				const maybeEmoji = await word();
				const emoji = parseEmoji(maybeEmoji) ? maybeEmoji : null;
				if (!emoji) args.restore();
				return { group, sub, panelId, role, emoji, label: await rest() };
			}
			if (sub === 'create') {
				const kind = (await word()).toLowerCase();
				if (!isPanelKind(kind)) usage(USAGE);
				let mode: PanelMode = 'normal';
				let channelId: string | null = message.channelId;
				let messageId: string | null = null;
				// Optional words in any order before the title: a mode, a #channel, a message link.
				for (;;) {
					args.save();
					const next = await word();
					const lower = next.toLowerCase();
					const link = parseMessageLink(next);
					if (isPanelMode(lower)) mode = lower;
					else if (link) ({ channelId, messageId } = link);
					else if (/^<#\d{17,20}>$/.test(next)) channelId = snowflakeFrom(next);
					else {
						args.restore();
						break;
					}
				}
				return { group, sub, kind, mode, channelId, messageId, title: await rest() };
			}
			return usage(USAGE);
		}

		if (group === 'autorole' || group === 'sticky') {
			if (sub === 'list') return { group, sub };
			if (sub !== 'add' && sub !== 'remove') usage(USAGE);
			const role = await pickRole();
			if (group === 'sticky') return { group, sub, role };
			const target = (await word()).toLowerCase().replace(/s$/, '');
			if (target && !isAutoRoleTarget(target)) usage(USAGE);
			return { group, sub, role, target: target === 'bot' ? 'bot' : 'human' };
		}
		return usage(USAGE);
	}

	private execute(ctx: ModContext, request: Request) {
		if (request.group === 'panel') return this.panel(ctx, request);
		if (request.group === 'autorole') return this.autorole(ctx, request);
		return this.sticky(ctx, request);
	}

	// -----------------------------------------------------------------------------------------
	// Panels
	// -----------------------------------------------------------------------------------------

	private requirePanel(guildId: string, panelId: number | null | undefined): RolePanel {
		const panel = panelId ? getPanel(guildId, panelId) : null;
		if (!panel) throw new ModError(`there's no panel #${panelId ?? '?'} here. \`/roles panel list\` shows them.`);
		return panel;
	}

	private async panel({ guild, moderator }: ModContext, request: Request): Promise<string> {
		switch (request.sub) {
			case 'list': {
				const panels = getPanels(guild.id);
				if (!panels.length) return 'no role panels yet. `/roles panel create` makes one.';
				return [
					'**Role panels:**',
					...panels.map((panel) => {
						const count = getEntries(panel.id).length;
						const link = `https://discord.com/channels/${guild.id}/${panel.channel_id}/${panel.message_id}`;
						return `**#${panel.id}** ${panel.kind}, ${panel.mode} · ${count} role${count === 1 ? '' : 's'} · [message](${link})${panel.title ? ` · ${panel.title}` : ''}`;
					})
				].join('\n');
			}

			case 'create': {
				const kind = request.kind!;
				const mode = request.mode ?? 'normal';
				if (countPanels(guild.id) >= MAX_PANELS_PER_GUILD)
					throw new ModError(`this server already has ${MAX_PANELS_PER_GUILD} panels. delete one first.`);
				const channel = request.channelId ? guild.channels.cache.get(request.channelId) : null;
				if (!channel?.isTextBased() || channel.isDMBased()) throw new ModError("I can't use that channel.");
				const existing = request.messageId !== null && request.messageId !== undefined;
				if (existing && kind !== 'reaction')
					throw new ModError('only reaction panels can use an existing message. buttons and menus need a message I post.');
				const missing = missingPanelPermissions(guild, channel.id, kind, !existing);
				if (missing.length) throw new ModError(`I need ${missing.join(', ')} in <#${channel.id}>.`);

				if (existing) {
					const target = await channel.messages.fetch(request.messageId!).catch(() => null);
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
					return `🧩 panel **#${panel.id}** set up on [that message](${target.url}). add roles with \`/roles panel add panel:${panel.id} role:@Role emoji:🎮\`.`;
				}

				const draft = { id: 0, kind, mode, title: request.title ?? null, description: request.description ?? null } as RolePanel;
				const sent = await channel.send({ embeds: [buildPanelEmbed(draft, [])], allowedMentions: { parse: [] } });
				let panel: RolePanel;
				try {
					panel = createPanel({
						guildId: guild.id,
						channelId: channel.id,
						messageId: sent.id,
						kind,
						mode,
						title: request.title,
						description: request.description,
						owned: true,
						createdBy: moderator.id
					});
				} catch (error) {
					await sent.delete().catch(() => undefined);
					throw error;
				}
				// Re-render now the panel has its number for the footer.
				await refreshPanel(guild, panel).catch(() => undefined);
				return `🧩 panel **#${panel.id}** posted in <#${channel.id}>. add roles with \`/roles panel add panel:${panel.id} role:@Role\`.`;
			}

			case 'add': {
				const panel = this.requirePanel(guild.id, request.panelId);
				const role = request.role!;
				await assertSelfAssignable(moderator, role);
				const emoji = request.emoji ? parseEmoji(request.emoji) : null;
				if (request.emoji && !emoji)
					throw new ModError(`"${request.emoji}" isn't an emoji I can use. Use one emoji, or a custom one like <:name:id>.`);
				if (panel.kind === 'reaction' && !emoji) throw new ModError('reaction panels need an emoji for each role.');
				const previous = getEntries(panel.id).find((entry) => entry.role_id === role.id) ?? null;
				try {
					upsertEntry(panel, { roleId: role.id, emoji, label: request.label });
				} catch (error) {
					throw new ModError(error instanceof Error ? error.message : String(error));
				}
				try {
					await refreshPanel(guild, panel);
				} catch (error) {
					// Put the panel back how it was, so the stored entries match the message.
					if (previous) {
						upsertEntry(panel, { roleId: role.id, emoji: parseEmoji(previous.emoji), label: previous.label });
					} else {
						removeEntry(panel.id, role.id);
					}
					await refreshPanel(guild, panel).catch(() => undefined);
					throw error;
				}
				if (previous?.emoji_key && previous.emoji_key !== emoji?.key) await removePanelReaction(guild, panel, previous.emoji_key);
				return `${previous ? '✏️ updated' : '➕ added'} <@&${role.id}>${emoji ? ` (${emoji.text})` : ''} on panel **#${panel.id}**.`;
			}

			case 'remove': {
				const panel = this.requirePanel(guild.id, request.panelId);
				const role = request.role!;
				const removed = removeEntry(panel.id, role.id);
				if (!removed) throw new ModError(`<@&${role.id}> isn't on panel #${panel.id}.`);
				await refreshPanel(guild, panel).catch(() => undefined);
				await removePanelReaction(guild, panel, removed.emoji_key);
				return `➖ took <@&${role.id}> off panel **#${panel.id}**. Members who have it keep it.`;
			}

			case 'mode': {
				const panel = this.requirePanel(guild.id, request.panelId);
				setPanelMode(guild.id, panel.id, request.mode!);
				await refreshPanel(guild, { ...panel, mode: request.mode! }).catch(() => undefined);
				return `🔧 panel **#${panel.id}** is in **${request.mode}** mode now.`;
			}

			case 'delete': {
				const panel = this.requirePanel(guild.id, request.panelId);
				await tearDownPanel(guild, panel);
				deletePanel(guild.id, panel.id);
				return `🗑️ deleted panel **#${panel.id}**${panel.owned ? ' and its message' : ''}. Members keep the roles they picked.`;
			}
		}
		return usage(USAGE);
	}

	// -----------------------------------------------------------------------------------------
	// Auto-role and sticky roles
	// -----------------------------------------------------------------------------------------

	private intentHint(): string {
		return membersIntentEnabled() ? '' : `\n${MEMBERS_INTENT_HINT}`;
	}

	private async autorole({ guild, moderator }: ModContext, request: Request): Promise<string> {
		if (request.sub === 'list') {
			const humans = getAutoRoles(guild.id, 'human');
			const bots = getAutoRoles(guild.id, 'bot');
			const show = (ids: string[]) => (ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : 'none');
			return `**Auto-roles:**\nhumans: ${show(humans)}\nbots: ${show(bots)}${this.intentHint()}`;
		}
		const role = request.role!;
		const target = request.target ?? 'human';
		const before = getAutoRoles(guild.id, target);
		const setting = target === 'bot' ? 'auto_roles_bots' : 'auto_roles_humans';
		const actor = auditActor(moderator, 'discord');
		const who = target === 'bot' ? 'bots' : 'new members';

		if (request.sub === 'add') {
			await assertSelfAssignable(moderator, role);
			if (before.includes(role.id)) throw new ModError(`${who} already get <@&${role.id}>.`);
			if (before.length >= MAX_AUTO_ROLES) throw new ModError(`that's ${MAX_AUTO_ROLES} auto-roles already. remove one first.`);
			addAutoRole(guild.id, role.id, target);
			recordConfigChange(guild.id, actor, 'moderation', setting, before.join(','), getAutoRoles(guild.id, target).join(','));
			return `👋 ${who} get <@&${role.id}> when they join.${this.intentHint()}`;
		}
		if (request.sub === 'remove') {
			if (!removeAutoRole(guild.id, role.id, target))
				throw new ModError(`<@&${role.id}> isn't an auto-role for ${target === 'bot' ? 'bots' : 'humans'}.`);
			recordConfigChange(guild.id, actor, 'moderation', setting, before.join(','), getAutoRoles(guild.id, target).join(','));
			return `👋 ${who} no longer get <@&${role.id}>.`;
		}
		return usage(USAGE);
	}

	private async sticky({ guild, moderator }: ModContext, request: Request): Promise<string> {
		const before = getStickyRoles(guild.id);
		if (request.sub === 'list') {
			const list = before.length ? before.map((id) => `<@&${id}>`).join(', ') : 'none';
			return `**Sticky roles:** ${list}${this.intentHint()}`;
		}
		const role = request.role!;
		const actor = auditActor(moderator, 'discord');
		if (request.sub === 'add') {
			// Sticky roles may carry permissions: they only come back to someone who already had them.
			await assertSelfAssignable(moderator, role, false);
			if (before.includes(role.id)) throw new ModError(`<@&${role.id}> is already sticky.`);
			if (before.length >= MAX_STICKY_ROLES) throw new ModError(`that's ${MAX_STICKY_ROLES} sticky roles already. remove one first.`);
			addStickyRole(guild.id, role.id);
			recordConfigChange(guild.id, actor, 'moderation', 'sticky_roles', before.join(','), getStickyRoles(guild.id).join(','));
			// Members who hold it now must be in the cache to be remembered when they leave.
			if (membersIntentEnabled()) await guild.members.fetch().catch(() => undefined);
			return `📌 <@&${role.id}> is sticky now: leaving and rejoining won't shake it off.${this.intentHint()}`;
		}
		if (request.sub === 'remove') {
			if (!removeStickyRole(guild.id, role.id)) throw new ModError(`<@&${role.id}> isn't sticky.`);
			recordConfigChange(guild.id, actor, 'moderation', 'sticky_roles', before.join(','), getStickyRoles(guild.id).join(','));
			return `📌 <@&${role.id}> isn't sticky any more.`;
		}
		return usage(USAGE);
	}
}
