import { ApplyOptions } from '@sapphire/decorators';
import { Command, CommandOptionsRunTypeEnum, type Args } from '@sapphire/framework';
import { ChannelType, InteractionContextType, PermissionFlagsBits, type Message } from 'discord.js';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { contextOf, restText, usage, type ModContext } from '../../lib/modCommand';
import { MAX_TICKET_SUBJECT } from '../../lib/modQueue';
import { closeTicketThread, openTicket, ticketPanelPayload } from '../../lib/modQueueActions';

const USAGE = '`%ticket open [subject]` | `%ticket close [reason]` | `%ticket panel [#channel]`';

/**
 * Tickets (LYRA-12): a private thread between a member and staff. Members can also open one from
 * the panel button or by DMing Lyra. Posting the panel needs Manage Server.
 */
@ApplyOptions<Command.Options>({
	name: 'ticket',
	description: 'Open or close a private ticket with the moderators',
	runIn: [CommandOptionsRunTypeEnum.GuildAny]
})
export class TicketCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.setContexts(InteractionContextType.Guild)
				.addSubcommand((sub) =>
					sub
						.setName('open')
						.setDescription('Open a private thread with the moderators')
						.addStringOption((o) => o.setName('subject').setDescription('What it is about').setMaxLength(MAX_TICKET_SUBJECT))
				)
				.addSubcommand((sub) =>
					sub
						.setName('close')
						.setDescription('Close the ticket this thread belongs to')
						.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
				)
				.addSubcommand((sub) =>
					sub
						.setName('panel')
						.setDescription('Post an "Open a ticket" button (Manage Server)')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Where to post it (default: here)')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						)
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(
			interaction,
			() =>
				this.execute(
					contextOf(interaction),
					interaction.options.getSubcommand(true),
					interaction.options.getString('subject') ?? interaction.options.getString('reason'),
					interaction.options.getChannel('channel')?.id ?? null,
					interaction.channel
				),
			{ defer: true, ephemeral: true }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			if (sub === 'panel') {
				const word = await args.pick('string').catch(() => null);
				return this.execute(contextOf(message), sub, null, word ? snowflakeFrom(word) : null, message.channel);
			}
			if (sub === 'open' || sub === 'close') return this.execute(contextOf(message), sub, await restText(args), null, message.channel);
			return usage(USAGE);
		});
	}

	private async execute(
		{ guild, moderator: member }: ModContext,
		sub: string,
		text: string | null,
		channelId: string | null,
		here: Message['channel'] | null
	) {
		if (sub === 'open') {
			const { thread, existing } = await openTicket(guild, member.user, text);
			return existing ? `you already have a ticket open: <#${thread.id}>` : `📩 ticket opened: <#${thread.id}>`;
		}
		if (sub === 'close') {
			if (!here?.isThread()) throw new ModError('run that inside the ticket thread.');
			return closeTicketThread(here, member, text);
		}
		if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new ModError('you need **Manage Server** to post the ticket panel.');
		const target = channelId ? guild.channels.cache.get(channelId) : here;
		if (!target?.isSendable() || target.isDMBased()) throw new ModError("I can't post in that channel.");
		await target.send(ticketPanelPayload(guild.name));
		return `📩 posted the ticket panel in <#${target.id}>.`;
	}
}
