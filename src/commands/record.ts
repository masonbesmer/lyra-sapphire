import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { GuildMember } from 'discord.js';
import { joinVoiceChannel, createAudioResource, AudioPlayerStatus, createAudioPlayer, StreamType } from '@discordjs/voice';
import { Transform } from 'stream';
import { Readable } from 'stream';
import { promises as fsPromises } from 'fs';
import { createWriteStream, createReadStream } from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

@ApplyOptions<Command.Options>({
  name: 'record',
  description: 'Records audio from the voice channel for a specified duration',
  detailedDescription: `
    Records audio from your current voice channel for a specified duration.
    
    Usage: 
    - record <duration>
    
    Example:
    - record 30s (records for 30 seconds)
    - record 2m (records for 2 minutes)
  `
})
export class RecordCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName('duration')
            .setDescription('Duration to record (e.g., 30s, 2m)')
            .setRequired(true)
        )
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();

    const duration = interaction.options.getString('duration', true);
    const member = interaction.member as GuildMember;
    const connection = member.voice?.channel;

    if (!connection) {
      return interaction.editReply('You need to be in a voice channel to use this command!');
    }

    const durationMs = this.parseDuration(duration);
    if (!durationMs) {
      return interaction.editReply('Invalid duration format. Use numbers followed by s (seconds) or m (minutes).');
    }

    try {
      // Create a temporary file for recording
      const tempFilePath = path.join(process.cwd(), 'temp', `recording-${Date.now()}.ogg`);
      await fsPromises.mkdir(path.dirname(tempFilePath), { recursive: true });

      // Create the audio player and connection
      const player = createAudioPlayer();
      const resource = createAudioResource(Readable.from([]), {
        inputType: StreamType.OggOpus
      });

      // Ensure the user is in a voice channel
      if (!interaction.member || !('voice' in interaction.member)) {
        await interaction.reply({ content: 'You need to be in a voice channel to use this command!', ephemeral: true });
        return;
      }

      // Ensure we have a guild
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server!', ephemeral: true });
        return;
      }

      // Join the voice channel
      const voiceConnection = joinVoiceChannel({
        channelId: interaction.member.voice.channelId!,
        guildId: interaction.guildId!,
        adapterCreator: interaction.guild.voiceAdapterCreator!
      });

      // Create a write stream for the recording
      const writeStream = createWriteStream(tempFilePath);

      // Create a transform stream to handle the audio data
      const audioStream = new Transform({
        transform(chunk: Buffer, _encoding: string, callback: () => void) {
          writeStream.write(chunk);
          callback();
        }
      });

      // Set up the audio player to receive audio data
      player.on(AudioPlayerStatus.Playing, () => {
        voiceConnection.subscribe(player);
      });

      // Connect the audio stream to the player
      player.play(resource);

      // Set up a timeout to stop recording
      setTimeout(async () => {
        audioStream.destroy();
        writeStream.end();

        // Wait for the file to be written
        await new Promise<void>((resolve) => {
          writeStream.on('finish', () => resolve());
        });

        // Compress the file
        const zipPath = tempFilePath + '.zip';
        await this.compressFile(tempFilePath, zipPath);

        // Send the file
        await interaction.editReply({
          content: 'Here is your recording:',
          files: [zipPath]
        });

        // Clean up temporary files
        await fsPromises.unlink(tempFilePath);
        await fsPromises.unlink(zipPath);
      }, durationMs);

      return interaction.editReply(`Recording started! Will record for ${duration}.`);
    } catch (error) {
      console.error('Error recording audio:', error);
      return interaction.editReply('An error occurred while recording audio.');
    }
  }

  private parseDuration(duration: string): number | null {
    const match = duration.match(/^(\d+)([sm])$/);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    return unit === 'm' ? value * 60 * 1000 : value * 1000;
  }

  private async compressFile(inputPath: string, outputPath: string): Promise<void> {
    const input = createReadStream(inputPath);
    const compressedStream = createWriteStream(outputPath);
    const zip = zlib.createGzip();

    input.pipe(zip).pipe(compressedStream);
    await new Promise<void>((resolve) => {
      compressedStream.on('finish', () => resolve());
      compressedStream.on('error', (err) => {
        console.error('Error compressing file:', err);
        resolve();
      });
    });
  }
}
