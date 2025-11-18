import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType, type VoiceReceiver } from '@discordjs/voice';
import { AttachmentBuilder, GuildMember } from 'discord.js';
import { opus } from 'prism-media';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { tmpdir } from 'node:os';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pipeline } from 'node:stream/promises';

@ApplyOptions<Command.Options>({
	name: 'record',
	description: 'Record audio from your voice channel'
})
export class RecordCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option.setName('seconds').setDescription('How many seconds to record').setRequired(true).setMinValue(1).setMaxValue(120)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const duration = interaction.options.getInteger('seconds', true);
		if (!(interaction.member instanceof GuildMember)) {
			return interaction.reply({ content: 'Could not get your member info.', ephemeral: true });
		}

		const channel = interaction.member.voice.channel;
		if (!channel) {
			return interaction.reply({ content: 'Join a voice channel first!', ephemeral: true });
		}

		await interaction.deferReply();

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
			return interaction.followUp('Failed to join the voice channel.');
		}

		const receiver = connection.receiver;
		const captureSessions = new Map<string, { stop: () => Promise<string | null> }>();
		const tempDir = tmpdir();

		const speakingListener = (userId: string) => {
			if (captureSessions.has(userId)) return;

			const session = this.createCaptureSession(receiver, userId, tempDir);
			captureSessions.set(userId, session);
		};

		receiver.speaking.on('start', speakingListener);

		try {
			await delay(duration * 1000);
		} finally {
			receiver.speaking.off('start', speakingListener);
			connection.destroy();
		}

		const recordedFiles = (
			await Promise.all(
				[...captureSessions.values()].map((session) =>
					session.stop().catch((error) => {
						this.container.logger.error(`Error finalising recording: ${error instanceof Error ? error.message : error}`);
						return null;
					})
				)
			)
		).filter((file): file is string => Boolean(file));

		if (recordedFiles.length === 0) {
			return interaction.followUp('No audio was recorded.');
		}

		const cleanupTargets = new Set(recordedFiles);
		const finalPath = join(tempDir, `recording-${Date.now()}.ogg`);
		cleanupTargets.add(finalPath);

		try {
			await this.mixRecordings(recordedFiles, finalPath);
		} catch (error) {
			this.container.logger.error(`ffmpeg error: ${error instanceof Error ? error.message : error}`);
			await this.cleanupFiles(cleanupTargets);
			return interaction.followUp('Failed to process the recording.');
		}

		const attachmentName = 'voice-recording.ogg';
		const attachment = new AttachmentBuilder(finalPath).setName(attachmentName);

		try {
			await interaction.followUp({ content: `<@${interaction.user.id}> recording complete!`, files: [attachment] });
		} finally {
			await this.cleanupFiles(cleanupTargets);
		}
	}

	private mixRecordings(inputs: string[], output: string) {
		// Normalise each per-user stream via ffmpeg so the final attachment has proper metadata.
		return new Promise<void>((resolve, reject) => {
			const args = ['-y'];
			for (const input of inputs) {
				args.push('-i', input);
			}

			if (inputs.length === 1) {
				args.push('-c', 'copy');
			} else {
				args.push('-filter_complex', `amix=inputs=${inputs.length}:duration=longest`);
			}

			args.push(output);

			const ffmpegProcess = spawn(ffmpeg.path, args, { windowsHide: true });
			ffmpegProcess.once('error', reject);
			ffmpegProcess.once('close', (code) => {
				if (code === 0) {
					return resolve();
				}
				reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`));
			});
		});
	}

	private async cleanupFiles(files: Iterable<string>) {
		for (const file of files) {
			await unlink(file).catch((error: NodeJS.ErrnoException) => {
				if (error?.code !== 'ENOENT') {
					this.container.logger.error(`Failed to delete ${file}: ${error.message}`);
				}
			});
		}
	}

	private createCaptureSession(receiver: VoiceReceiver, userId: string, tempDir: string) {
		const opusStream = receiver.subscribe(userId, {
			end: { behavior: EndBehaviorType.Manual }
		});
		const file = join(tempDir, `${Date.now()}-${userId}.ogg`);
		const oggStream = new opus.OggLogicalBitstream({
			opusHead: new opus.OpusHead({ channelCount: 2, sampleRate: 48000 }),
			pageSizeControl: { maxPackets: 10 }
		});
		const out = createWriteStream(file);

		let byteCount = 0;
		const dataListener = (chunk: Buffer) => {
			byteCount += chunk.length;
		};
		opusStream.on('data', dataListener);

		const pipelinePromise = pipeline(opusStream, oggStream, out).catch((error) => {
			const nodeError = error as NodeJS.ErrnoException;
			if (!nodeError?.code || !['ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED'].includes(nodeError.code)) {
				throw error;
			}
		});

		let stopped = false;
		const finalize = async () => {
			opusStream.off('data', dataListener);
			await pipelinePromise;
			if (byteCount === 0) {
				await unlink(file).catch((unlinkError: NodeJS.ErrnoException) => {
					if (unlinkError?.code !== 'ENOENT') {
						this.container.logger.error(`Failed to delete empty recording ${file}: ${unlinkError.message}`);
					}
				});
				return null;
			}
			return file;
		};

		const stop = async () => {
			if (!stopped) {
				stopped = true;
				opusStream.destroy();
			}
			return finalize();
		};

		return { stop };
	}
}
