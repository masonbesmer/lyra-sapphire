import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message, type Role } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';
import { assertSelfAssignable } from '../../lib/selfRoleActions';
import { addPanelRole, changePanelMode, createRolePanel, deleteRolePanel, removePanelRole, requirePanel } from '../../lib/rolePanelOps';
import {
	MAX_AUTO_ROLES,
	MAX_DESCRIPTION_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_STICKY_ROLES,
	MAX_TITLE_LENGTH,
	addAutoRole,
	addStickyRole,
	getAutoRoles,
	getEntries,
	getPanels,
	getStickyRoles,
	isAutoRoleTarget,
	isPanelKind,
	isPanelMode,
	parseEmoji,
	parseMessageLink,
	removeAutoRole,
	removeStickyRole,
	type AutoRoleTarget,
	type PanelKind,
	type PanelMode
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

	private async panel({ guild, moderator }: ModContext, request: Request): Promise<string> {
		const actor = auditActor(moderator, 'discord');
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
				const { panel, url, adopted } = await createRolePanel(guild, moderator, actor, {
					kind: request.kind!,
					mode: request.mode ?? 'normal',
					channelId: request.channelId ?? null,
					messageId: request.messageId,
					title: request.title,
					description: request.description
				});
				if (adopted)
					return `🧩 panel **#${panel.id}** set up on [that message](${url}). add roles with \`/roles panel add panel:${panel.id} role:@Role emoji:🎮\`.`;
				return `🧩 panel **#${panel.id}** posted in <#${panel.channel_id}>. add roles with \`/roles panel add panel:${panel.id} role:@Role\`.`;
			}

			case 'add': {
				const panel = requirePanel(guild.id, request.panelId);
				const role = request.role!;
				const { previous, emoji } = await addPanelRole(guild, moderator, actor, panel, role, request.emoji ?? null, request.label ?? null);
				return `${previous ? '✏️ updated' : '➕ added'} <@&${role.id}>${emoji ? ` (${emoji.text})` : ''} on panel **#${panel.id}**.`;
			}

			case 'remove': {
				const panel = requirePanel(guild.id, request.panelId);
				const role = request.role!;
				await removePanelRole(guild, actor, panel, role.id);
				return `➖ took <@&${role.id}> off panel **#${panel.id}**. Members who have it keep it.`;
			}

			case 'mode': {
				const panel = requirePanel(guild.id, request.panelId);
				await changePanelMode(guild, actor, panel, request.mode!);
				return `🔧 panel **#${panel.id}** is in **${request.mode}** mode now.`;
			}

			case 'delete': {
				const panel = requirePanel(guild.id, request.panelId);
				await deleteRolePanel(guild, actor, panel);
				return `🗑️ deleted panel **#${panel.id}**${panel.owned ? ' and its message' : ''}. Members keep the roles they picked.`;
			}
		}
		return usage(USAGE);
	}

	// -----------------------------------------------------------------------------------------
	// Auto-role and sticky roles
	// -----------------------------------------------------------------------------------------

	private async autorole({ guild, moderator }: ModContext, request: Request): Promise<string> {
		if (request.sub === 'list') {
			const humans = getAutoRoles(guild.id, 'human');
			const bots = getAutoRoles(guild.id, 'bot');
			const show = (ids: string[]) => (ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : 'none');
			return `**Auto-roles:**\nhumans: ${show(humans)}\nbots: ${show(bots)}`;
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
			return `👋 ${who} get <@&${role.id}> when they join.`;
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
			return `**Sticky roles:** ${list}`;
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
			await guild.members.fetch().catch(() => undefined);
			return `📌 <@&${role.id}> is sticky now: leaving and rejoining won't shake it off.`;
		}
		if (request.sub === 'remove') {
			if (!removeStickyRole(guild.id, role.id)) throw new ModError(`<@&${role.id}> isn't sticky.`);
			recordConfigChange(guild.id, actor, 'moderation', 'sticky_roles', before.join(','), getStickyRoles(guild.id).join(','));
			return `📌 <@&${role.id}> isn't sticky any more.`;
		}
		return usage(USAGE);
	}
}
