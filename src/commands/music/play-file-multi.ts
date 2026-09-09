import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { GuildMember, Message, MessageFlags, type Attachment } from 'discord.js';
import { MAX_FILES_PER_COMMAND, playAttachments } from '../../lib/attachmentAudio';

@ApplyOptions<Command.Options>({
	name: 'play-file-multi',
	description: 'Queue several audio files you upload at once',
	preconditions: ['InVoiceWithBot'],
	// A batch is up to MAX_FILES_PER_COMMAND full-file pulls on Lavalink's side, so it gets a
	// longer leash than the single-file command.
	cooldownDelay: 30_000,
	cooldownLimit: 2
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => {
			builder.setName(this.name).setDescription(this.description);
			// Slash commands have no repeatable option type, so the batch is N discrete slots.
			for (let i = 1; i <= MAX_FILES_PER_COMMAND; i++) {
				builder.addAttachmentOption((option) =>
					option
						.setName(`file${i}`)
						.setDescription(i === 1 ? 'Audio file to play' : `Audio file #${i} (optional)`)
						.setRequired(i === 1)
				);
			}
			return builder;
		});
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel!;

		const files: Attachment[] = [];
		for (let i = 1; i <= MAX_FILES_PER_COMMAND; i++) {
			const file = interaction.options.getAttachment(`file${i}`, false);
			if (file) files.push(file);
		}

		await interaction.deferReply();

		try {
			const content = await playAttachments(this.container.client.kazagumo, files, {
				guildId: interaction.guildId,
				voiceChannelId: channel.id,
				textChannelId: interaction.channelId,
				requester: interaction.user,
				interaction
			});
			// Filenames are user-controlled and reach the channel verbatim; `@everyone.mp3` is a
			// legal upload name and markdown escaping does nothing to it.
			return interaction.editReply({ content, allowedMentions: { parse: [] } });
		} catch (e) {
			this.container.logger.error(`[play-file-multi] ${String(e)}`);
			return interaction.editReply('something went wrong on my end, check the logs.');
		}
	}

	public override async messageRun(message: Message) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply("can't do that outside a server.");
		}
		const channel = message.member.voice.channel;
		if (!channel) return message.reply("hey dumbass, you aren't in a voice channel.");

		const files = [...message.attachments.values()];
		if (!files.length) return message.reply('attach the audio files to the message. example: drag a few `.mp3`s in and send `%play-file-multi`');

		const statusMsg = await message.reply(`📂 loading ${Math.min(files.length, MAX_FILES_PER_COMMAND)} file(s)...`);

		try {
			const content = await playAttachments(this.container.client.kazagumo, files, {
				guildId: message.guildId,
				voiceChannelId: channel.id,
				textChannelId: message.channelId,
				requester: message.author,
				interaction: message
			});
			return statusMsg.edit({ content, allowedMentions: { parse: [] } });
		} catch (e) {
			this.container.logger.error(`[play-file-multi] ${String(e)}`);
			return statusMsg.edit('something went wrong on my end, check the logs.');
		}
	}
}
