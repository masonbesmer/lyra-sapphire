import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { GuildMember, Message, MessageFlags } from 'discord.js';
import { MAX_ATTACHMENT_BYTES, playAttachments } from '../../lib/attachmentAudio';

@ApplyOptions<Command.Options>({
	name: 'play-file',
	description: 'Play an audio file you upload',
	preconditions: ['InVoiceWithBot'],
	// Resolving an upload makes Lavalink pull the whole file over the network, so this is the one
	// play path a single user can make expensive by repeating it quickly.
	cooldownDelay: 10_000,
	cooldownLimit: 3
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addAttachmentOption((option) =>
					option.setName('file').setDescription(`Audio file (mp3, flac, wav, ogg, opus, m4a — max ${maxMegabytes()} MB)`).setRequired(true)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel!;
		const file = interaction.options.getAttachment('file', true);

		await interaction.deferReply();

		try {
			const content = await playAttachments(this.container.client.kazagumo, [file], {
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
			this.container.logger.error(`[play-file] ${String(e)}`);
			return interaction.editReply('something went wrong on my end, check the logs.');
		}
	}

	public override async messageRun(message: Message) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply("can't do that outside a server.");
		}
		const channel = message.member.voice.channel;
		if (!channel) return message.reply("hey dumbass, you aren't in a voice channel.");

		const file = message.attachments.first();
		if (!file) return message.reply('attach an audio file to the message. example: drag a `.mp3` in and send `%play-file`');

		const statusMsg = await message.reply('📂 loading that file...');

		try {
			const content = await playAttachments(this.container.client.kazagumo, [file], {
				guildId: message.guildId,
				voiceChannelId: channel.id,
				textChannelId: message.channelId,
				requester: message.author,
				interaction: message
			});
			return statusMsg.edit({ content, allowedMentions: { parse: [] } });
		} catch (e) {
			this.container.logger.error(`[play-file] ${String(e)}`);
			return statusMsg.edit('something went wrong on my end, check the logs.');
		}
	}
}

function maxMegabytes(): number {
	return Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024));
}
