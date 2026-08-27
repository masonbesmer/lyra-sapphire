import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { EndBehaviorType, VoiceConnection, type VoiceReceiver } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import type { User, Client } from 'discord.js';
import { OpusEncoder } from '@discordjs/opus';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';

// Ensure recordings directory exists
async function ensureRecordingsDir() {
	try {
		await mkdir('./recordings', { recursive: true });
	} catch {
		// Directory might already exist, ignore
	}
}

/**
 * Records a single user's audio stream to a WAV file with timestamp synchronization
 * @param receiver - The voice receiver to subscribe to
 * @param user - The user to record
 * @param duration - Maximum recording duration in milliseconds
 * @param startTime - The recording session start time in milliseconds (for time sync)
 * @param timestamp - Unique timestamp for filename
 * @returns The filename of the recorded audio
 */
export async function recordUser(receiver: VoiceReceiver, user: User, duration: number, startTime: number, timestamp: number): Promise<string> {
	await ensureRecordingsDir();

	const opusStream = receiver.subscribe(user.id, {
		end: {
			behavior: EndBehaviorType.Manual
		}
	});

	const filename = `./recordings/${timestamp}-${user.id}.wav`;
	const out = createWriteStream(filename);

	// Track audio packets with timestamps
	let lastPacketTime = startTime;
	const sampleRate = 48000;
	const channels = 2;
	const bytesPerSample = 2;

	// Generate silence buffer (20ms worth)
	const silenceSamplesPerPacket = Math.floor((20 / 1000) * sampleRate);
	const silenceBytesPerPacket = silenceSamplesPerPacket * channels * bytesPerSample;
	const silencePacket = Buffer.alloc(silenceBytesPerPacket, 0);

	try {
		container.logger.debug(`🎙️ Starting user recording: ${user.username} (${user.id}), duration=${duration}ms, file=${filename}`);
		const ffmpegProcess = spawn(
			ffmpegPath,
			[
				'-f',
				's16le',
				'-ar',
				'48000',
				'-ac',
				'2',
				'-i',
				'pipe:0',
				'-af',
				'volume=1.5', // Boost volume by 50%
				'-f',
				'wav',
				'pipe:1'
			],
			{
				stdio: ['pipe', 'pipe', 'pipe']
			}
		);

		const ffmpegOutput = ffmpegProcess.stdout as Readable;
		ffmpegProcess.stderr?.on('data', () => {});

		const pipelinePromise = pipeline(ffmpegOutput, out);

		// Decode Opus to PCM. Discord sends 20ms Opus frames at 48kHz stereo.
		//
		// Decoded packet-at-a-time rather than through prism's Transform on purpose. A Transform
		// that throws in _transform is destroyed by Node, and @discordjs/voice hands us packets it
		// could not E2EE-decrypt as-is (DAVE passes ciphertext straight through until its MLS
		// session is ready). Piped, that packet emitted an unhandled 'error' and took the process
		// down. Dropping it and carrying on is the only behaviour that survives a DAVE channel;
		// the gap it leaves is filled by the silence padding below, so the track stays aligned.
		const opusDecoder = new OpusEncoder(48000, 2);

		opusStream.on('data', (packet: Buffer) => {
			let pcmData: Buffer;
			try {
				pcmData = opusDecoder.decode(packet);
			} catch (error) {
				container.logger.warn(`[recorder] dropped an undecodable packet for ${user.id}: ${String(error)}`);
				return;
			}

			const now = Date.now();
			const timeSinceLastPacket = now - lastPacketTime;

			// If there's a gap > 40ms, fill it with silence (allows for network jitter)
			if (timeSinceLastPacket > 40) {
				const silencePackets = Math.floor(timeSinceLastPacket / 20);
				for (let i = 0; i < silencePackets; i++) {
					ffmpegProcess.stdin?.write(silencePacket);
				}
			}

			// Write actual audio - PCM data is already decoded from Opus
			// The decoder outputs the correct sample size
			ffmpegProcess.stdin?.write(pcmData);
			lastPacketTime = now;
		});

		opusStream.on('error', (error) => {
			container.logger.warn(`[recorder] opus stream for ${user.id}: ${String(error)}`);
		});

		// Record for exact duration
		await new Promise<void>((resolve) => {
			setTimeout(async () => {
				opusStream.destroy();
				await new Promise((r) => setTimeout(r, 100));

				// Fill from last packet time to recording end with silence
				const recordingEndTime = startTime + duration;
				const remainingTime = recordingEndTime - lastPacketTime;
				if (remainingTime > 0) {
					const remainingPackets = Math.ceil(remainingTime / 20);
					for (let i = 0; i < remainingPackets; i++) {
						ffmpegProcess.stdin?.write(silencePacket);
					}
				}

				ffmpegProcess.stdin?.end();
				await pipelinePromise;
				resolve();
			}, duration);
		});

		container.logger.info(`✅ Recorded ${filename}`);
		return filename;
	} catch (error: any) {
		container.logger.warn(`❌ Error recording ${filename}: ${error.message}`);
		throw error;
	}
}

/**
 * Records all users in a voice channel
 * @param connection - The voice connection
 * @param duration - Recording duration in milliseconds
 * @param client - The Discord client to fetch users
 * @returns Object containing the merged filename
 */
export async function recordAllUsers(connection: VoiceConnection, duration: number, client: Client): Promise<{ file: string | null }> {
	container.logger.debug(`🎯 Starting voice channel recording for ${duration}ms`);
	const receiver = connection.receiver;
	const recordedUsers = new Map<string, Promise<string>>();

	// Shared start time and timestamp for all recordings
	const startTime = Date.now();
	const timestamp = startTime;

	// Get all users currently in the voice channel
	const guildId = connection.joinConfig.guildId;
	const channelId = connection.joinConfig.channelId;

	if (!channelId) {
		container.logger.error('❌ No channel ID found in connection');
		return { file: null };
	}

	const guild = await client.guilds.fetch(guildId);
	const channel = await guild.channels.fetch(channelId);

	if (!channel || !channel.isVoiceBased()) {
		container.logger.error('❌ Channel not found or is not a voice channel');
		return { file: null };
	}

	// Start recording all users already in the channel
	for (const [userId, member] of channel.members) {
		if (!member.user.bot) {
			container.logger.debug(`👤 Starting recording for existing user: ${member.user.username} (${userId})`);
			const recordPromise = recordUser(receiver, member.user, duration, startTime, timestamp);
			recordedUsers.set(userId, recordPromise);
		}
	}

	// Listen for speaking events to catch any users who join during recording
	const speakingHandler = (userId: string) => {
		container.logger.debug(`🗣️ User started speaking: ${userId}`);
		if (!recordedUsers.has(userId)) {
			container.logger.debug(`➕ Adding new user to recording queue: ${userId}`);
			const elapsedTime = Date.now() - startTime;
			const remainingDuration = Math.max(0, duration - elapsedTime);

			// Start recording this user
			const recordPromise = (async () => {
				try {
					const user = await client.users.fetch(userId);
					if (user && !user.bot) {
						return await recordUser(receiver, user, remainingDuration, startTime, timestamp);
					}
				} catch (error) {
					container.logger.error(`Failed to record user ${userId}: ${String(error)}`);
				}
				return null;
			})();

			recordedUsers.set(userId, recordPromise as Promise<string>);
		}
	};

	receiver.speaking.on('start', speakingHandler);

	// Wait for the specified duration
	container.logger.debug(`⏳ Waiting for ${duration}ms recording duration...`);
	await new Promise((resolve) => setTimeout(resolve, duration));
	container.logger.debug(`⏰ Recording duration complete, detected ${recordedUsers.size} user(s)`);

	// Stop listening for new speakers
	receiver.speaking.off('start', speakingHandler);

	// Give a bit more time for recordings to finish flushing
	container.logger.debug(`⏸️ Waiting 2s for all recordings to finish flushing...`);
	await new Promise((resolve) => setTimeout(resolve, 2000));

	// Wait for all recordings to complete
	container.logger.debug(`⏳ Awaiting completion of ${recordedUsers.size} recording(s)...`);
	const recordings = await Promise.allSettled(Array.from(recordedUsers.values()));

	// Log any failures
	recordings.forEach((result, index) => {
		if (result.status === 'rejected') {
			container.logger.error(`❌ Recording ${index + 1} failed: ${String(result.reason)}`);
		}
	});

	// Filter out successful recordings
	const successfulRecordings = recordings
		.filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled' && result.value !== null)
		.map((result) => result.value);

	container.logger.info(`📊 Recording summary: ${successfulRecordings.length}/${recordings.length} successful`);
	container.logger.debug(`📁 Files ready to send: ${successfulRecordings.join(',')}`);

	// Merge all tracks into one file
	if (successfulRecordings.length > 0) {
		try {
			// Format timestamp as YYYY-MM-DD-HH:MM
			const date = new Date(timestamp);
			const formattedTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
			const mergedFilename = `./recordings/${formattedTimestamp}.wav`;
			container.logger.debug(`🎛️ Merging ${successfulRecordings.length} tracks into ${mergedFilename}...`);

			// Build FFmpeg command to mix all audio files with normalization
			const inputs = successfulRecordings.flatMap((file) => ['-i', file]);
			// Mix with weights to prevent clipping, then apply dynamic compression to handle peaks
			const filterComplex = `amix=inputs=${successfulRecordings.length}:duration=first:dropout_transition=0`;

			await new Promise<void>((resolve, reject) => {
				const mergeProcess = spawn(ffmpegPath, [...inputs, '-filter_complex', filterComplex, '-ar', '48000', '-ac', '2', mergedFilename]);

				mergeProcess.on('close', (code) => {
					if (code === 0) {
						container.logger.info(`✅ Merged track created: ${mergedFilename}`);
						resolve();
					} else {
						container.logger.error(`❌ FFmpeg merge failed with code: ${code}`);
						reject(new Error(`FFmpeg merge failed with code: ${code}`));
					}
				});

				mergeProcess.on('error', (error) => {
					container.logger.error(`❌ FFmpeg merge error: ${String(error)}`);
					reject(error);
				});
			});

			return { file: mergedFilename };
		} catch (error) {
			container.logger.error(`❌ Failed to merge tracks: ${String(error)}`);
			return { file: null };
		}
	}

	return { file: null };
}
