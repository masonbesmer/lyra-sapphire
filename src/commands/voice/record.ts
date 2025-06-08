import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import { GuildMember, VoiceBasedChannel, User, MessageFlags } from 'discord.js';
import prism from 'prism-media';
import { pipeline } from 'node:stream';
import { createWriteStream, unlink } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

interface Recording {
	file: string;
	stream: import('@discordjs/voice').AudioReceiveStream;
}

function createListeningStream(receiver: any, userId: string, user?: User): Recording {
	const opusStream = receiver.subscribe(userId, {
		end: {
			behavior: EndBehaviorType.AfterSilence,
			duration: 100
		}
	});
	const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
	const filename = join(tmpdir(), `${Date.now()}-${user ? `${user.username}_${user.discriminator}` : userId}.pcm`);
	const out = createWriteStream(filename);
	pipeline(opusStream, decoder, out, (err) => {
		if (err) console.warn(`Error recording ${filename} - ${err.message}`);
	});
	return { file: filename, stream: opusStream };
}

async function mixAudio(files: Recording[], output: string) {
	return new Promise<void>((resolve, reject) => {
		const args: string[] = [];
		for (const rec of files) {
			args.push('-f', 's16le', '-ar', '48000', '-ac', '2', '-i', rec.file);
		}
		args.push('-filter_complex', `amix=inputs=${files.length}:duration=longest`);
		args.push('-c:a', 'libmp3lame', '-y', output);
		const ff = spawn(ffmpeg.path, args);
		ff.on('close', (code) => {
			code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`));
		});
	});
}

@ApplyOptions<Command.Options>({
	description: 'Record audio from your voice channel'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option.setName('duration').setDescription('Duration in seconds').setRequired(true).setMinValue(1).setMaxValue(600)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const duration = interaction.options.getInteger('duration', true);
		if (!(interaction.member instanceof GuildMember) || !interaction.member.voice.channel) {
			return interaction.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
		}
		const channel = interaction.member.voice.channel as VoiceBasedChannel;
		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
			selfDeaf: false,
			selfMute: true
		});

		try {
			await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
		} catch {
			connection.destroy();
			return interaction.reply({ content: 'Failed to join voice channel.', flags: MessageFlags.Ephemeral });
		}

		await interaction.reply({ content: `Recording for ${duration} seconds...`, flags: MessageFlags.Ephemeral });

		const receiver = connection.receiver;
		const recordings: Recording[] = [];
		const recordedUsers = new Set<string>();

		const startRecording = (member: GuildMember) => {
			if (member.user.bot || recordedUsers.has(member.id)) return;
			recordedUsers.add(member.id);
			const rec = createListeningStream(receiver, member.id, member.user);
			recordings.push(rec);
		};

		for (const [, member] of channel.members) startRecording(member);
		receiver.speaking.on('start', (userId: string) => {
			const member = channel.members.get(userId);
			if (member) startRecording(member);
		});

		await new Promise((res) => setTimeout(res, duration * 1000));

		connection.destroy();
		receiver.speaking.removeAllListeners();

		const output = join(tmpdir(), `recording-${Date.now()}.mp3`);
		if (recordings.length === 0) {
			await interaction.editReply('No audio recorded');
			return;
		}
		try {
			await mixAudio(recordings, output);
			await channel.send({ content: `${interaction.user}`, files: [output] });
		} catch (error) {
			await interaction.editReply('Failed to process audio.');
		} finally {
			for (const rec of recordings) {
				rec.stream.destroy();
				unlink(rec.file, () => undefined);
			}
			unlink(output, () => undefined);
		}
	}
}
