import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { EndBehaviorType, VoiceConnection, type VoiceReceiver } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import type { User, Client } from 'discord.js';
import prism from 'prism-media';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';

// Ensure recordings directory exists
async function ensureRecordingsDir() {
	try {
		await mkdir('./recordings', { recursive: true });
	} catch (error) {
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

		// Decode Opus to PCM
		// Discord sends 20ms Opus frames at 48kHz stereo
		const opusDecoder = new prism.opus.Decoder({
			rate: 48000,
			channels: 2,
			frameSize: 960 // 20ms at 48kHz = 960 samples per channel
		});

		// Handle decoded audio - insert silence for gaps
		opusDecoder.on('data', (pcmData: Buffer) => {
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

		opusStream.pipe(opusDecoder);

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
 * @returns Object containing merged filename and transcription text (if available)
 */
export async function recordAllUsers(
	connection: VoiceConnection,
	duration: number,
	client: Client
): Promise<{ file: string | null; transcription: string | null }> {
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
		return { file: null, transcription: null };
	}

	const guild = await client.guilds.fetch(guildId);
	const channel = await guild.channels.fetch(channelId);

	if (!channel || !channel.isVoiceBased()) {
		container.logger.error('❌ Channel not found or is not a voice channel');
		return { file: null, transcription: null };
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

			// Transcribe the merged audio
			try {
				container.logger.debug(`📝 Starting transcription of merged audio...`);
				const transcription = await transcribeAudio(mergedFilename);
				return { file: mergedFilename, transcription };
			} catch (transcriptionError) {
				container.logger.error(`⚠️ Transcription failed, continuing without it: ${String(transcriptionError)}`);
				return { file: mergedFilename, transcription: null };
			}
		} catch (error) {
			container.logger.error(`❌ Failed to merge tracks: ${String(error)}`);
			return { file: null, transcription: null };
		}
	}

	return { file: null, transcription: null };
}

/**
 * Read audio file and convert to Float32Array for Whisper
 * @param audioFile - Path to the WAV file
 * @returns Audio data as Float32Array with sample rate
 */
async function readAudioFile(audioFile: string): Promise<{ audio: Float32Array; sampling_rate: number }> {
	// Read the WAV file
	const wavBuffer = readFileSync(audioFile);

	// WAV file format: skip 44-byte header for standard WAV
	const headerSize = 44;
	const dataBuffer = wavBuffer.subarray(headerSize);

	// Our WAV files are 16-bit PCM, stereo, 48kHz
	const int16Array = new Int16Array(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.length / 2);

	// Convert stereo to mono by averaging channels
	const monoSamples = new Float32Array(int16Array.length / 2);
	for (let i = 0; i < monoSamples.length; i++) {
		const left = int16Array[i * 2] / 32768.0;
		const right = int16Array[i * 2 + 1] / 32768.0;
		monoSamples[i] = (left + right) / 2;
	}

	// Whisper expects 16kHz audio, we need to resample from 48kHz
	const resampledAudio = await resampleAudio(monoSamples, 48000, 16000);

	return { audio: resampledAudio, sampling_rate: 16000 };
}

/**
 * Simple resampling function (linear interpolation)
 * @param audio - Input audio samples
 * @param fromRate - Original sample rate
 * @param toRate - Target sample rate
 * @returns Resampled audio
 */
async function resampleAudio(audio: Float32Array, fromRate: number, toRate: number): Promise<Float32Array> {
	if (fromRate === toRate) return audio;

	const ratio = fromRate / toRate;
	const newLength = Math.round(audio.length / ratio);
	const result = new Float32Array(newLength);

	for (let i = 0; i < newLength; i++) {
		const srcIndex = i * ratio;
		const srcIndexFloor = Math.floor(srcIndex);
		const srcIndexCeil = Math.min(srcIndexFloor + 1, audio.length - 1);
		const t = srcIndex - srcIndexFloor;

		// Linear interpolation
		result[i] = audio[srcIndexFloor] * (1 - t) + audio[srcIndexCeil] * t;
	}

	return result;
}

/**
 * Check if audio contains actual speech (simple voice activity detection)
 * @param audio - Audio samples
 * @returns True if audio likely contains speech
 */
function hasVoiceActivity(audio: Float32Array): boolean {
	// Calculate RMS (root mean square) energy
	let sumSquares = 0;
	for (let i = 0; i < audio.length; i++) {
		sumSquares += audio[i] * audio[i];
	}
	const rms = Math.sqrt(sumSquares / audio.length);

	// If RMS is below threshold, likely just silence
	const silenceThreshold = 0.01; // Adjust based on testing
	if (rms < silenceThreshold) {
		return false;
	}

	// Check for dynamic range (speech has varying amplitude)
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < audio.length; i++) {
		if (audio[i] < min) min = audio[i];
		if (audio[i] > max) max = audio[i];
	}
	const dynamicRange = max - min;

	// If dynamic range is too small, likely just noise or silence
	const minDynamicRange = 0.02;
	return dynamicRange > minDynamicRange;
}

/**
 * Transcribe an audio file using Whisper
 * @param audioFile - Path to the audio file to transcribe
 * @returns The transcription text
 */
export async function transcribeAudio(audioFile: string): Promise<string> {
	try {
		container.logger.debug(`🎤 Starting transcription of ${audioFile}...`);

		// Read and prepare audio data
		const { audio } = await readAudioFile(audioFile);

		// Check if audio contains actual voice activity
		if (!hasVoiceActivity(audio)) {
			container.logger.debug(`⏭️ Skipping transcription - no voice activity detected`);
			return '';
		}

		// Dynamically import transformers (ESM module)
		const { pipeline } = await import('@xenova/transformers');

		// Initialize the transcriber with Whisper tiny model
		// Model will be downloaded on first use (~80MB)
		const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');

		// Transcribe with raw audio data
		const result = await transcriber(audio, {
			chunk_length_s: 30, // Process in 30-second chunks
			stride_length_s: 5, // 5-second stride between chunks
			return_timestamps: false
		} as any);

		container.logger.info(`✅ Transcription complete`);

		// Handle both single result and array results
		const text = Array.isArray(result) ? result.map((r: any) => r.text).join(' ') : (result as any).text;
		const cleanedText = text.trim();

		// Filter out common Whisper hallucinations
		const hallucinations = ['[Music]', '[BLANK_AUDIO]', '[Silence]', '[Applause]', '[Laughter]'];
		const filteredText = cleanedText
			.split(' ')
			.filter((word: string) => !hallucinations.some((h) => word.includes(h.slice(1, -1))))
			.join(' ')
			.trim();

		// If only hallucinations were detected, return empty string
		if (!filteredText || filteredText.length < 3) {
			container.logger.debug(`⏭️ Skipping transcription - only hallucinations detected`);
			return '';
		}

		return filteredText;
	} catch (error: any) {
		container.logger.error(`❌ Transcription error: ${String(error.message)}`);
		throw error;
	}
}
