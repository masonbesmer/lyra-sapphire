import { ApplyOptions } from '@sapphire/decorators';
import { Command, CommandOptionsRunTypeEnum, type Args } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ApplicationCommandType,
	InteractionContextType,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type Message
} from 'discord.js';
import { MOD_PREFIX } from '../../lib/modButtons';
import { ModError, describeError } from '../../lib/modActions';
import { pickUser, restText } from '../../lib/modCommand';
import { MAX_REPORT_REASON } from '../../lib/modQueue';
import { fileReport } from '../../lib/modQueueActions';

export const REPORT_MESSAGE_MENU = 'Report message';

/**
 * /report (LYRA-12): anyone can report a member, or a message from its context menu. Reports go
 * to the mod queue channel set with /modqueue reports, and the reporter is only ever answered
 * privately (the prefix form deletes the command message and answers by DM).
 */
@ApplyOptions<Command.Options>({
	name: 'report',
	description: 'Report a member to the moderators (only they see it)',
	runIn: [CommandOptionsRunTypeEnum.GuildAny]
})
export class ReportCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.setContexts(InteractionContextType.Guild)
				.addUserOption((o) => o.setName('user').setDescription('Who you are reporting').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('What happened').setRequired(true).setMaxLength(MAX_REPORT_REASON))
		);
		registry.registerContextMenuCommand((builder) =>
			builder.setName(REPORT_MESSAGE_MENU).setType(ApplicationCommandType.Message).setContexts(InteractionContextType.Guild)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			if (!interaction.inCachedGuild()) throw new ModError('reports only work in a server.');
			const text = await fileReport({
				guild: interaction.guild,
				reporter: interaction.user,
				target: interaction.options.getUser('user', true),
				reason: interaction.options.getString('reason', true)
			});
			return interaction.editReply({ content: text, allowedMentions: { parse: [] } });
		} catch (error) {
			return interaction.editReply({ content: `❌ ${describeError(error)}`, allowedMentions: { parse: [] } });
		}
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isMessageContextMenuCommand() || !interaction.inCachedGuild()) return;
		const target = interaction.targetMessage;
		// The reason comes from a modal; the listener in src/listeners/modInteractions.ts files it.
		return interaction.showModal(
			new ModalBuilder()
				.setCustomId(`${MOD_PREFIX}report-modal:${target.channelId}:${target.id}`)
				.setTitle(`Report ${target.author.username}'s message`.slice(0, 45))
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId('reason')
							.setLabel("What's wrong with it?")
							.setStyle(TextInputStyle.Paragraph)
							.setMaxLength(MAX_REPORT_REASON)
							.setRequired(true)
					)
				)
		);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.inGuild()) return;
		// Don't leave who reported whom sitting in the channel.
		await message.delete().catch(() => undefined);
		let text: string;
		try {
			const user = await pickUser(args);
			const reason = await restText(args);
			if (!user || !reason) throw new ModError('usage: `%report @user <reason>` (or use `/report`, which nobody else sees)');
			text = await fileReport({ guild: message.guild, reporter: message.author, target: user, reason });
		} catch (error) {
			text = `❌ ${describeError(error)}`;
		}
		return message.author.send({ content: `**${message.guild.name}:** ${text}`, allowedMentions: { parse: [] } }).catch(() => undefined);
	}
}
