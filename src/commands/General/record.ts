import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { joinVoiceChannel, VoiceConnectionStatus, entersState, EndBehaviorType } from '@discordjs/voice';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { AttachmentBuilder, GuildMember } from 'discord.js';
import prism from 'prism-media';
import ffmpegPathPkg from '@ffmpeg-installer/ffmpeg';

@ApplyOptions<Command.Options>({
	name: 'record',
	description: 'Record the last X seconds of the voice channel'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) => option.setName('seconds').setDescription('Seconds to record').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const seconds = interaction.options.getInteger('seconds', true);
		if (interaction.member === null) return interaction.reply('You must be in a voice channel.');
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel;
		if (!channel) return interaction.reply('You are not in a voice channel.');

		await interaction.deferReply();

		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator
		});

		try {
			await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
		} catch {
			connection.destroy();
			return interaction.editReply('Failed to join voice channel.');
		}

		const receiver = connection.receiver;
		const output = new PassThrough();

		receiver.speaking.on('start', (userId) => {
			const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 500 } });
			const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
			opusStream.pipe(decoder).pipe(output, { end: false });
		});

		await new Promise((res) => setTimeout(res, seconds * 1000));
		connection.destroy();
		output.end();

		const ffmpegPath = ffmpegPathPkg.path;
		const ffmpeg = spawn(ffmpegPath, ['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0', '-acodec', 'libopus', '-f', 'ogg', 'pipe:1']);

		const chunks: Buffer[] = [];
		ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
		output.pipe(ffmpeg.stdin);

		await new Promise((res) => ffmpeg.on('close', res));

		const audioBuffer = Buffer.concat(chunks);
		const attachment = new AttachmentBuilder(audioBuffer, { name: 'recording.ogg' });

		return interaction.editReply({
			content: `Here is your recording, <@${interaction.user.id}>`,
			files: [attachment]
		});
	}
}
