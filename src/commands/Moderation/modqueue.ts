import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Guild, type Message } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';
import { getModQueueConfig, isAppealUrl, setModQueueField, type ModQueueField } from '../../lib/modQueue';

const USAGE =
	'`%modqueue view` | `%modqueue reports <#channel|off>` | `%modqueue tickets <#channel [@staff]|off>` | `%modqueue appeals <[#channel] [url]|off>`';

type Changes = Partial<Record<ModQueueField, string | null>>;

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

/** /modqueue (LYRA-12): where reports, tickets and ban appeals go. Leaving a feature's options out turns it off. */
@ApplyOptions<ModCommandOptions>({
	name: 'modqueue',
	description: 'Where reports, tickets and ban appeals go',
	permission: PermissionFlagsBits.ManageGuild,
	clientPermission: 0n
})
export class ModqueueCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show the current settings'))
				.addSubcommand((sub) =>
					sub
						.setName('reports')
						.setDescription('Channel that receives /report (omit to turn reports off)')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Mod queue channel')
								.addChannelTypes(...TEXT_CHANNELS)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('tickets')
						.setDescription('Text channel that holds ticket threads (omit to turn tickets off)')
						.addChannelOption((o) => o.setName('channel').setDescription('Ticket channel').addChannelTypes(ChannelType.GuildText))
						.addRoleOption((o) => o.setName('staff_role').setDescription('Role pinged into each new ticket'))
				)
				.addSubcommand((sub) =>
					sub
						.setName('appeals')
						.setDescription('Ban appeals: a channel for the built-in form and/or an outside link (omit both to turn off)')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Where appeals are posted')
								.addChannelTypes(...TEXT_CHANNELS)
						)
						.addStringOption((o) => o.setName('url').setDescription('Link to an outside appeal form').setMaxLength(512))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => {
			const sub = interaction.options.getSubcommand(true);
			const channel = interaction.options.getChannel('channel')?.id ?? null;
			const changes: Changes =
				sub === 'reports'
					? { report_channel_id: channel }
					: sub === 'tickets'
						? { ticket_channel_id: channel, staff_role_id: channel ? (interaction.options.getRole('staff_role')?.id ?? null) : null }
						: sub === 'appeals'
							? { appeal_channel_id: channel, appeal_url: interaction.options.getString('url')?.trim() || null }
							: {};
			return this.execute(contextOf(interaction), sub, changes);
		});
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			const words = (await args.repeat('string').catch(() => [] as string[])).filter(Boolean);
			const off = words.length === 1 && words[0].toLowerCase() === 'off';
			if (sub === 'view') return this.execute(contextOf(message), sub, {});
			if (sub === 'reports' && words.length)
				return this.execute(contextOf(message), sub, { report_channel_id: off ? null : this.idFrom(words[0]) });
			if (sub === 'tickets' && words.length) {
				return this.execute(
					contextOf(message),
					sub,
					off
						? { ticket_channel_id: null, staff_role_id: null }
						: { ticket_channel_id: this.idFrom(words[0]), staff_role_id: words[1] ? this.idFrom(words[1]) : null }
				);
			}
			if (sub === 'appeals' && words.length) {
				if (off) return this.execute(contextOf(message), sub, { appeal_channel_id: null, appeal_url: null });
				const url = words.find((word) => /^https?:\/\//i.test(word)) ?? null;
				const channelWord = words.find((word) => word !== url) ?? null;
				return this.execute(contextOf(message), sub, { appeal_channel_id: channelWord ? this.idFrom(channelWord) : null, appeal_url: url });
			}
			return usage(USAGE);
		});
	}

	private idFrom(word: string): string {
		const id = snowflakeFrom(word);
		if (!id) usage(USAGE);
		return id;
	}

	private validate(guild: Guild, changes: Changes): void {
		for (const field of ['report_channel_id', 'ticket_channel_id', 'appeal_channel_id'] as const) {
			const id = changes[field];
			if (!id) continue;
			const channel = guild.channels.cache.get(id);
			if (!channel?.isSendable()) throw new ModError(`I can't post in <#${id}>.`);
			if (field === 'ticket_channel_id') {
				if (channel.type !== ChannelType.GuildText)
					throw new ModError('tickets need a regular text channel (they are private threads in it).');
				const me = guild.members.me;
				if (me && !channel.permissionsFor(me).has([PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads])) {
					throw new ModError(`I need **Create Private Threads** and **Send Messages in Threads** in <#${id}>.`);
				}
			}
		}
		if (changes.staff_role_id && !guild.roles.cache.has(changes.staff_role_id)) throw new ModError("that role doesn't exist here.");
		if (changes.appeal_url && !isAppealUrl(changes.appeal_url)) throw new ModError('the appeal link has to be an http(s) URL.');
	}

	private async execute({ guild, moderator }: ModContext, sub: string, changes: Changes) {
		const before = getModQueueConfig(guild.id);
		if (sub === 'view') {
			const channel = (id: string | null) => (id ? `<#${id}>` : 'off');
			return [
				'**Mod queue settings:**',
				`reports → ${channel(before.report_channel_id)}`,
				`tickets → ${channel(before.ticket_channel_id)}${before.staff_role_id ? ` (staff: <@&${before.staff_role_id}>)` : ''}`,
				`appeals → ${channel(before.appeal_channel_id)}${before.appeal_url ? ` · link: <${before.appeal_url}>` : ''}`
			].join('\n');
		}

		this.validate(guild, changes);
		const actor = auditActor(moderator, 'discord');
		for (const [field, value] of Object.entries(changes) as [ModQueueField, string | null][]) {
			if (before[field] === value) continue;
			setModQueueField(guild.id, field, value);
			recordConfigChange(guild.id, actor, 'moderation', field, before[field], value);
		}

		if (sub === 'reports') return changes.report_channel_id ? `📨 reports go to <#${changes.report_channel_id}>.` : '📨 reports are off.';
		if (sub === 'tickets') {
			if (!changes.ticket_channel_id) return '📩 tickets are off. open tickets stay open.';
			return `📩 tickets open as private threads in <#${changes.ticket_channel_id}>${changes.staff_role_id ? `, pinging <@&${changes.staff_role_id}>` : ''}. post a button with \`/ticket panel\`.`;
		}
		if (!changes.appeal_channel_id && !changes.appeal_url) return '⚖️ ban appeals are off.';
		const parts = [
			changes.appeal_channel_id ? `the form posts to <#${changes.appeal_channel_id}>` : null,
			changes.appeal_url ? `the link is <${changes.appeal_url}>` : null
		];
		return `⚖️ ban DMs now offer an appeal: ${parts.filter(Boolean).join(', and ')}.`;
	}
}
