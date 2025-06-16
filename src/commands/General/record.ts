import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import { AttachmentBuilder, GuildMember } from 'discord.js';
import { opus } from 'prism-media';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { tmpdir } from 'node:os';
import { createWriteStream, unlink } from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';

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
		const recordedFiles: string[] = [];
		const users = new Set<string>();

		receiver.speaking.on('start', (userId) => {
			if (users.has(userId)) return;
			users.add(userId);

			const opusStream = receiver.subscribe(userId, {
				end: { behavior: EndBehaviorType.AfterSilence, duration: 100 }
			});

                        const oggStream = new opus.OggLogicalBitstream({
                                opusHead: new opus.OpusHead({ channelCount: 2, sampleRate: 48000 }),
                                pageSizeControl: { maxPackets: 10 }
                        });

			const file = `${tmpdir()}/${Date.now()}-${userId}.ogg`;
			recordedFiles.push(file);
			const out = createWriteStream(file);
			pipeline(opusStream, oggStream, out, (err) => {
				if (err) {
					this.container.logger.error(`Error recording ${file}: ${err.message}`);
				}
			});
		});

		await new Promise((res) => setTimeout(res, duration * 1000));
		connection.destroy();

		if (recordedFiles.length === 0) {
			return interaction.followUp('No audio was recorded.');
		}

		const output = `${tmpdir()}/recording-${Date.now()}.ogg`;
		const inputs = recordedFiles.map((f) => `-i ${f}`).join(' ');
		const filter = `-filter_complex amix=inputs=${recordedFiles.length}:duration=longest`;
		const cmd = `${ffmpeg.path} -y ${inputs} ${filter} ${output}`;
		try {
			await promisify(exec)(cmd);
		} catch (err) {
			this.container.logger.error(`ffmpeg error: ${err}`);
			return interaction.followUp('Failed to process the recording.');
		}

		recordedFiles.forEach((f) => unlink(f, () => {}));

		const attachment = new AttachmentBuilder(output);
		await interaction.followUp({ content: `<@${interaction.user.id}>`, files: [attachment] });
		unlink(output, () => {});
	}
}
