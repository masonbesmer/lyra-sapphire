import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import { GuildMember, Message, AttachmentBuilder } from 'discord.js';
import { recordAllUsers } from '../../lib/recorder';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';

@ApplyOptions<Command.Options>({
	name: 'record',
	description: 'Record all users in your voice channel for a specified duration',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option
						.setName('duration')
						.setDescription('Recording duration in seconds (max 300)')
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(300)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({ content: 'This command can only be used in a server!', ephemeral: true });
		}

		const member = interaction.member as GuildMember;
		const channel = member.voice.channel;

		if (!channel) {
			return interaction.reply({ content: 'You need to be in a voice channel!', ephemeral: true });
		}

		const durationSeconds = interaction.options.getInteger('duration', true);
		const durationMs = durationSeconds * 1000;

		await interaction.deferReply();

		try {
			// Check if already connected, otherwise join
			let connection = getVoiceConnection(interaction.guildId);

			if (!connection) {
				connection = joinVoiceChannel({
					channelId: channel.id,
					guildId: interaction.guildId,
					adapterCreator: interaction.guild.voiceAdapterCreator,
					selfDeaf: false,
					selfMute: true
				});

				// Wait for connection to be ready
				await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
			}

			await interaction.followUp(`🎙️ Recording started for ${durationSeconds} seconds...`);

			// Record all users
			const result = await recordAllUsers(connection, durationMs, interaction.client);

			if (result.files.length === 0) {
				return interaction.followUp('No audio was recorded. Make sure users are speaking!');
			}

			// Send all recordings as attachments
			const attachments: AttachmentBuilder[] = [];
			for (const filename of result.files) {
				const attachment = new AttachmentBuilder(createReadStream(filename), {
					name: filename.split('/').pop() || 'recording.wav'
				});
				attachments.push(attachment);
			}

			// Build response message with transcription if available
			let content = `✅ Recording complete! Captured ${result.files.length} file(s).`;
			if (result.transcription) {
				content += `\n\n**Transcription:**\n${result.transcription}`;
			}

			await interaction.followUp({
				content,
				files: attachments
			});

			// Clean up files after sending
			for (const filename of result.files) {
				try {
					await unlink(filename);
				} catch (error) {
					console.error(`Failed to delete ${filename}:`, error);
				}
			}
		} catch (error) {
			console.error('Recording error:', error);
			return interaction.followUp({
				content: `Failed to record: ${error instanceof Error ? error.message : 'Unknown error'}`
			});
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply('This command can only be used in a server!');
		}

		const channel = message.member.voice.channel;
		if (!channel) {
			return message.reply('You need to be in a voice channel!');
		}

		// Parse duration argument
		const durationSeconds = await args.pick('integer').catch(() => null);
		if (!durationSeconds || durationSeconds < 1 || durationSeconds > 300) {
			return message.reply('Please provide a valid duration between 1 and 300 seconds! Example: `%record 30`');
		}

		const durationMs = durationSeconds * 1000;

		const statusMsg = await message.reply(`🎙️ Recording started for ${durationSeconds} seconds...`);

		try {
			// Check if already connected, otherwise join
			let connection = getVoiceConnection(message.guildId);

			if (!connection) {
				connection = joinVoiceChannel({
					channelId: channel.id,
					guildId: message.guildId,
					adapterCreator: message.guild.voiceAdapterCreator,
					selfDeaf: false,
					selfMute: true
				});

				// Wait for connection to be ready
				await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
			}

			// Record all users
			const result = await recordAllUsers(connection, durationMs, message.client);

			if (result.files.length === 0) {
				return statusMsg.edit('No audio was recorded. Make sure users are speaking!');
			}

			// Send all recordings as attachments
			const attachments: AttachmentBuilder[] = [];
			for (const filename of result.files) {
				const attachment = new AttachmentBuilder(createReadStream(filename), {
					name: filename.split('/').pop() || 'recording.wav'
				});
				attachments.push(attachment);
			}

			// Build response message with transcription if available
			let content = `✅ Recording complete! Captured ${result.files.length} file(s).`;
			if (result.transcription) {
				content += `\n\n**Transcription:**\n${result.transcription}`;
			}

			await message.reply({
				content,
				files: attachments
			});

			// Clean up files after sending
			for (const filename of result.files) {
				try {
					await unlink(filename);
				} catch (error) {
					console.error(`Failed to delete ${filename}:`, error);
				}
			}
		} catch (error) {
			console.error('Recording error:', error);
			return statusMsg.edit({
				content: `Failed to record: ${error instanceof Error ? error.message : 'Unknown error'}`
			});
		}
	}
}
