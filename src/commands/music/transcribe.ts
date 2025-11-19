import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import { GuildMember, Message, TextChannel } from 'discord.js';
import { startTranscriptionSession, stopTranscriptionSession, isTranscribing } from '../../lib/transcription';

@ApplyOptions<Command.Options>({
	name: 'transcribe',
	description: 'Toggle real-time voice transcription in this text channel (Whisper)',
	preconditions: ['InVoiceWithBot']
})
export class TranscribeCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({ content: 'This command must be used in a guild', ephemeral: true });
		}

		const member = interaction.member as GuildMember;
		const voiceChannel = member.voice.channel;
		if (!voiceChannel) return interaction.reply({ content: 'You need to be in a voice channel!', ephemeral: true });

		this.container.logger.debug(
			`[CMD:TRANSCRIBE] (${interaction.guildId}) chatInputRun by ${interaction.user.id} in channel ${interaction.channel?.id}`
		);
		await interaction.deferReply();

		const guildId = interaction.guildId!;
		if (isTranscribing(guildId)) {
			this.container.logger.debug(`[CMD:TRANSCRIBE] (${interaction.guildId}) stopping existing session`);
			await stopTranscriptionSession(guildId);
			await interaction.editReply('✅ Stopped real-time transcription.');
			return;
		}

		// Join the voice channel
		let connection = getVoiceConnection(guildId);
		if (!connection) {
			connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: guildId,
				adapterCreator: interaction.guild!.voiceAdapterCreator,
				selfDeaf: false,
				selfMute: true
			});
			await entersState(connection, VoiceConnectionStatus.Ready, 20000);
		}

		try {
			const channel = interaction.channel as TextChannel;
			this.container.logger.debug(`[CMD:TRANSCRIBE] (${interaction.guildId}) starting session in ${channel.id}`);
			await startTranscriptionSession(interaction.client, guildId, connection, channel);
			this.container.logger.debug(`[CMD:TRANSCRIBE] (${interaction.guildId}) session started`);
			await interaction.editReply(`🎧 Joined ${voiceChannel.name} and started real-time transcription in ${channel.name}.`);
		} catch (err) {
			this.container.logger.error(`[CMD:TRANSCRIBE] (${interaction.guildId}) Failed to start transcription session: ${String(err)}`);
			await interaction.editReply({ content: `Failed to start transcription: ${err instanceof Error ? err.message : 'Unknown'}` });
		}
	}

	public override async messageRun(message: Message) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply('This command can only be used in a server!');
		}

		const voiceChannel = message.member.voice.channel;
		if (!voiceChannel) return message.reply('You must be in a voice channel to use this command.');

		const guildId = message.guildId;
		this.container.logger.debug(`[CMD:TRANSCRIBE] (${guildId}) messageRun by ${message.author.id} in channel ${message.channel.id}`);
		try {
			if (isTranscribing(guildId)) {
				this.container.logger.debug(`[CMD:TRANSCRIBE] (${guildId}) stopping existing session`);
				await stopTranscriptionSession(guildId);
				await message.reply('✅ Stopped real-time transcription.');
				return;
			}

			// Join the voice channel
			let connection = getVoiceConnection(guildId);
			if (!connection) {
				connection = joinVoiceChannel({
					channelId: voiceChannel.id,
					guildId: guildId,
					adapterCreator: message.guild.voiceAdapterCreator,
					selfDeaf: false,
					selfMute: true
				});
				await entersState(connection, VoiceConnectionStatus.Ready, 20000);
			}

			const channel = message.channel as TextChannel;
			this.container.logger.debug(`[CMD:TRANSCRIBE] (${guildId}) starting session in ${channel.id}`);
			await startTranscriptionSession(message.client, guildId, connection, channel);
			this.container.logger.debug(`[CMD:TRANSCRIBE] (${guildId}) session started`);
			await message.reply(`🎧 Joined ${voiceChannel.name} and started real-time transcription in ${channel.name}.`);
		} catch (err) {
			this.container.logger.error(`[CMD:TRANSCRIBE] (${guildId}) Failed to start/stop transcription: ${String(err)}`);
			await message.reply(`Failed to start/stop transcription: ${err instanceof Error ? err.message : 'Unknown'}`);
		}
	}
}
