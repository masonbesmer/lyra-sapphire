import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, GuildMember, Message, AttachmentBuilder } from 'discord.js';
import { recordAllUsers } from '../../lib/recorder';
import { ensureReceiveConnection, releaseReceiveConnection } from '../../lib/voice/connection';
import { getListenerClient } from '../../lib/voice/listenerClient';
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
			return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		}

		const member = interaction.member as GuildMember;
		const channel = member.voice.channel;

		if (!channel) {
			return interaction.reply({ content: 'get in a voice channel first.', flags: MessageFlags.Ephemeral });
		}

		const durationSeconds = interaction.options.getInteger('duration', true);
		const durationMs = durationSeconds * 1000;

		await interaction.deferReply();

		try {
			const connection = await ensureReceiveConnection(interaction.guild.id, channel.id);
			const listener = getListenerClient()!;

			await interaction.followUp(`🎙️ recording for ${durationSeconds} seconds, starting now...`);

			// Record all users
			const result = await recordAllUsers(connection, durationMs, listener);

			if (!result.file) {
				return interaction.followUp("didn't catch any audio, is anyone actually talking?");
			}

			// Send merged recording as attachment
			const attachment = new AttachmentBuilder(createReadStream(result.file), {
				name: result.file.split('/').pop() || 'recording.wav'
			});

			const content = '✅ got it, recording done.';

			await interaction.followUp({
				content,
				files: [attachment]
			});

			// Clean up file after sending
			try {
				await unlink(result.file);
			} catch (error) {
				this.container.logger.error(`Failed to delete ${result.file}: ${String(error)}`);
			}

			return;
		} catch (error) {
			this.container.logger.error(`Recording error: ${String(error)}`);
			return interaction.followUp({
				content: `failed to record: ${error instanceof Error ? error.message : 'unknown error'}`
			});
		} finally {
			releaseReceiveConnection(interaction.guild.id);
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply("can't do that outside a server.");
		}

		const channel = message.member.voice.channel;
		if (!channel) {
			return message.reply('get in a voice channel first.');
		}

		// Parse duration argument
		const durationSeconds = await args.pick('integer').catch(() => null);
		if (!durationSeconds || durationSeconds < 1 || durationSeconds > 300) {
			return message.reply('give me a valid duration between 1 and 300 seconds. example: `%record 30`');
		}

		const durationMs = durationSeconds * 1000;

		const statusMsg = await message.reply(`🎙️ recording for ${durationSeconds} seconds, starting now...`);

		try {
			const connection = await ensureReceiveConnection(message.guild.id, channel.id);
			const listener = getListenerClient()!;

			// Record all users
			const result = await recordAllUsers(connection, durationMs, listener);

			if (!result.file) {
				return statusMsg.edit("didn't catch any audio, is anyone actually talking?");
			}

			// Send merged recording as attachment
			const attachment = new AttachmentBuilder(createReadStream(result.file), {
				name: result.file.split('/').pop() || 'recording.wav'
			});

			const content = '✅ got it, recording done.';

			await message.reply({
				content,
				files: [attachment]
			});

			// Clean up file after sending
			try {
				await unlink(result.file);
			} catch (error) {
				this.container.logger.error(`Failed to delete ${result.file}: ${String(error)}`);
			}

			return;
		} catch (error) {
			this.container.logger.error(`Recording error: ${String(error)}`);
			return statusMsg.edit({
				content: `failed to record: ${error instanceof Error ? error.message : 'unknown error'}`
			});
		} finally {
			releaseReceiveConnection(message.guild.id);
		}
	}
}
