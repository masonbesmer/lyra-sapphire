import { VoiceConnection, type VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import { getTranscribeConfig } from './config';
import prism from 'prism-media';
import type { Client, TextChannel, User, GuildMember, Message } from 'discord.js';
// pipeline/ffmpeg not required here

type PerUserState = {
	id: string;
	username: string;
	buffer: Buffer[];
	message: Message | null; // last sent/edited message in the transcription channel
	lastTranscription: string;
	decoder: prism.opus.Decoder | null;
	lastBytes: number; // number of bytes processed
	lastUpdate: number; // timestamp of last buffer append
	processing?: boolean; // currently being processed to avoid races
	pendingTimer?: NodeJS.Timeout | null; // short timer to flush buffer after a grace window
};

type TranscriptionSession = {
	guildId: string;
	voiceConnection: VoiceConnection;
	textChannelId: string;
	receiver: VoiceReceiver;
	transcriber: any | null;
	users: Map<string, PerUserState>;
	interval: NodeJS.Timeout | null;
	stop?: () => void;
};

const sessions = new Map<string, TranscriptionSession>();

// Load Xenova pipeline on demand and cache instance per session
async function loadTranscriber() {
	const { pipeline } = await import('@xenova/transformers');
	return await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
}

/**
 * Helper to convert interleaved PCM (s16le stereo 48k) Buffer -> Float32Array mono 16k
 */
async function convertPcmToFloat32MonoResample(buffer: Buffer): Promise<Float32Array> {
	const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));

	// Convert stereo to mono by averaging channels if even number of samples
	const samples = Math.floor(int16Array.length / 2);
	const mono = new Float32Array(samples);
	for (let i = 0; i < samples; i++) {
		const left = int16Array[i * 2] / 32768.0;
		const right = int16Array[i * 2 + 1] / 32768.0;
		mono[i] = (left + right) / 2;
	}

	// Resample linear interpolation from 48k to 16k
	const fromRate: number = 48000;
	const toRate: number = 16000;
	if (fromRate === toRate) return mono;
	const ratio = fromRate / toRate;
	const newLen = Math.round(mono.length / ratio);
	const out = new Float32Array(newLen);
	for (let i = 0; i < newLen; i++) {
		const src = i * ratio;
		const a = Math.floor(src);
		const b = Math.min(a + 1, mono.length - 1);
		const t = src - a;
		out[i] = mono[a] * (1 - t) + mono[b] * t;
	}
	return out;
}

/**
 * Start transcription session for a guild
 */
export async function startTranscriptionSession(client: Client, guildId: string, voiceConnection: VoiceConnection, textChannel: TextChannel) {
	if (sessions.has(guildId)) {
		throw new Error('Transcription already active for this guild');
	}

	const receiver = voiceConnection.receiver;
	const session: TranscriptionSession = {
		guildId,
		voiceConnection,
		textChannelId: textChannel.id,
		receiver,
		transcriber: null,
		users: new Map(),
		interval: null
	};

	// load transcriber
	try {
		container.logger.debug(`[TRANSCRIBE] (${guildId}) loading transcriber...`);
		session.transcriber = await loadTranscriber();
		container.logger.debug(`[TRANSCRIBE] (${guildId}) transcriber loaded`);
	} catch (err) {
		container.logger.error(`[TRANSCRIBE] (${guildId}) Failed to load transcriber: ${String(err)}`);
		session.transcriber = null;
	}

	// Load guild-specific config
	let dbCfg = getTranscribeConfig(guildId);

	// Constants for audio calculations
	const SAMPLE_RATE = 48000;
	const CHANNELS = 2;
	const BYTES_PER_SAMPLE = 2; // s16le
	const BYTE_RATE_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE; // 192000
	let MIN_AUDIO_SECONDS = dbCfg.min_audio_seconds ?? 0.5; // min seconds per chunk required before sending to ASR
	let MIN_AUDIO_BYTES = Math.floor(BYTE_RATE_PER_SECOND * MIN_AUDIO_SECONDS);
	let TRANSCRIBE_INTERVAL_MS = dbCfg.interval_ms ?? 2000; // how often we check buffers and transcribe (smaller => lower latency, higher CPU)
	let TRANCRIBE_CHUNK_S = dbCfg.chunk_s ?? 5; // chunk length fed to Whisper
	const GRACE_MS = 500; // grace window to aggregate small frames before forced transcription

	container.logger.debug(
		`[TRANSCRIBE] (${guildId}) session thresholds set: MIN_AUDIO_SECONDS=${MIN_AUDIO_SECONDS}, MIN_AUDIO_BYTES=${MIN_AUDIO_BYTES}, BYTE_RATE_PER_SECOND=${BYTE_RATE_PER_SECOND}, INTERVAL_MS=${TRANSCRIBE_INTERVAL_MS}, CHUNK_S=${TRANCRIBE_CHUNK_S}`
	);

	// Start per-user opus decoding and buffering
	const addUserToSession = async (userId: string) => {
		if (session.users.has(userId)) return;
		try {
			const user = await client.users.fetch(userId);
			if (!user || user.bot) return;
			const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
			const opusStream = receiver.subscribe(userId as string, { end: { behavior: EndBehaviorType.Manual } });
			const state: PerUserState = {
				id: userId,
				username: user.username,
				buffer: [],
				message: null,
				lastTranscription: '',
				decoder,
				lastBytes: 0,
				lastUpdate: Date.now(),
				pendingTimer: null
			};
			session.users.set(userId, state);

			opusStream.pipe(decoder);
			decoder.on('data', (pcm: Buffer) => {
				// push s16le 48k stereo to buffer
				state.buffer.push(Buffer.from(pcm));
				const bytes = state.buffer.reduce((a, b) => a + b.length, 0);
				const secondsBuffered = bytes / BYTE_RATE_PER_SECOND;
				state.lastUpdate = Date.now();
				// If a grace timer is already set, reset it
				if (state.pendingTimer) {
					clearTimeout(state.pendingTimer);
				}
				try {
					// Schedule a forced transcription after a short window so tiny fragments accumulate
					state.pendingTimer = setTimeout(async () => {
						try {
							const guild = await client.guilds.fetch(session.guildId);
							const ch = (await guild.channels.fetch(session.textChannelId)) as TextChannel | null;
							if (!ch) return;
							await processUserBuffer(session, state, ch, true);
						} catch (err) {
							container.logger.error(`[TRANSCRIBE] (${guildId}) grace timer error: ${String(err)}`);
						} finally {
							state.pendingTimer = null;
						}
					}, GRACE_MS);
				} catch (err) {
					container.logger.error(`[TRANSCRIBE] (${guildId}) failed to schedule grace timer: ${String(err)}`);
				}
				container.logger.debug(
					`[TRANSCRIBE] (${guildId}) buffer append for ${user.username} (${user.id}), bytes=${bytes}, secondsBuffered=${secondsBuffered.toFixed(3)}s`
				);
			});
			decoder.on('error', (err) => container.logger.error(`[TRANSCRIBE] (${guildId}) Decoder error for ${user.username}: ${String(err)}`));
			container.logger.debug(`[TRANSCRIBE] (${guildId}) Started streaming for user ${user.username} (${user.id})`);
		} catch (err) {
			container.logger.error(`[TRANSCRIBE] (${guildId}) Error setting up stream for user: ${String(err)}`);
		}
	};
	const speakingHandler = async (userId: string) => addUserToSession(userId);
	// When a user stops speaking, force-transcribe any remaining buffered audio for that user
	const endHandler = async (userId: string) => {
		try {
			const ustate = session.users.get(userId);
			if (!ustate) return;
			const guild = await client.guilds.fetch(session.guildId);
			const channel = (await guild.channels.fetch(session.textChannelId)) as TextChannel | null;
			if (!channel) return;
			await processUserBuffer(session, ustate, channel, true);
		} catch (err) {
			container.logger.error(`[TRANSCRIBE] (${guildId}) Error in endHandler for ${userId}: ${String(err)}`);
		}
	};

	receiver.speaking.on('start', speakingHandler);
	receiver.speaking.on('end', endHandler);

	// Helper to process buffer for a single user - `force` bypasses minimum bytes
	async function processUserBuffer(session: TranscriptionSession, ustate: PerUserState, channel: TextChannel, force = false) {
		if (!ustate || ustate.processing) return false;
		const bytesAvailable = ustate.buffer.reduce((a, b) => a + b.length, 0);
		const secondsAvailable = bytesAvailable / BYTE_RATE_PER_SECOND;
		if (!force && bytesAvailable < MIN_AUDIO_BYTES) {
			return false;
		}

		ustate.processing = true;
		try {
			const combined = Buffer.concat(ustate.buffer);
			ustate.buffer = [];
			ustate.lastBytes = 0;
			ustate.lastUpdate = Date.now();

			container.logger.debug(
				`[TRANSCRIBE] (${guildId}) processing buffer for ${ustate.username} (${ustate.id}) - bytes=${combined.length}, seconds=${(combined.length / BYTE_RATE_PER_SECOND).toFixed(3)}s, force=${force}`
			);
			if (!session.transcriber) return false;

			const floatAudio = await convertPcmToFloat32MonoResample(combined);
			const result = await session.transcriber(floatAudio, {
				chunk_length_s: TRANCRIBE_CHUNK_S,
				stride_length_s: 1,
				return_timestamps: false
			} as any);
			const text = Array.isArray(result) ? result.map((r: any) => r.text).join(' ') : (result as any).text;
			const cleaned = (text || '').trim();
			if (!cleaned) {
				container.logger.debug(`[TRANSCRIBE] (${guildId}) transcriber returned empty result for ${ustate.username} (forced=${force})`);
				return false;
			}

			ustate.lastTranscription = cleaned;

			const prefix = `**${ustate.username}**:`;
			if (ustate.message) {
				try {
					await ustate.message.edit(`${prefix} ${cleaned}`);
				} catch (err) {
					ustate.message = await channel.send(`${prefix} ${cleaned}`);
				}
			} else {
				ustate.message = await channel.send(`${prefix} ${cleaned}`);
			}

			return true;
		} catch (err) {
			container.logger.error(`[TRANSCRIBE] (${guildId}) processUserBuffer error for ${ustate.username}: ${String(err)}`);
			return false;
		} finally {
			ustate.processing = false;
		}
	}

	// Also add all current members in the channel (if any)
	try {
		const guild = await client.guilds.fetch(session.guildId);
		const channel = await guild.channels.fetch(session.voiceConnection.joinConfig.channelId as string);
		if (channel && channel.isVoiceBased()) {
			for (const [userId, member] of channel.members) {
				if (!member.user.bot) {
					await addUserToSession(userId);
				}
			}
		}
	} catch (err) {
		container.logger.warn(`[TRANSCRIBE] (${guildId}) Failed to add existing members to transcription session: ${String(err)}`);
	}

	// Setup background periodic worker for transcription
	let stopped = false;
	let timer: NodeJS.Timeout | null = null;

	const tick = async () => {
		if (stopped) return;
		// Refresh guild settings each tick so changes via /config immediately apply
		try {
			dbCfg = getTranscribeConfig(guildId);
			MIN_AUDIO_SECONDS = dbCfg.min_audio_seconds ?? MIN_AUDIO_SECONDS;
			MIN_AUDIO_BYTES = Math.floor(BYTE_RATE_PER_SECOND * MIN_AUDIO_SECONDS);
			TRANSCRIBE_INTERVAL_MS = dbCfg.interval_ms ?? TRANSCRIBE_INTERVAL_MS;
			TRANCRIBE_CHUNK_S = dbCfg.chunk_s ?? TRANCRIBE_CHUNK_S;
		} catch (err) {
			container.logger.error(`[TRANSCRIBE] (${guildId}) Failed to refresh DB config: ${String(err)}`);
		}
		// Refresh guild settings each tick so changes via /config immediately apply
		try {
			dbCfg = getTranscribeConfig(guildId);
			MIN_AUDIO_SECONDS = dbCfg.min_audio_seconds ?? MIN_AUDIO_SECONDS;
			MIN_AUDIO_BYTES = Math.floor(BYTE_RATE_PER_SECOND * MIN_AUDIO_SECONDS);
			TRANSCRIBE_INTERVAL_MS = dbCfg.interval_ms ?? TRANSCRIBE_INTERVAL_MS;
			TRANCRIBE_CHUNK_S = dbCfg.chunk_s ?? TRANCRIBE_CHUNK_S;
		} catch (err) {
			container.logger.error(`[TRANSCRIBE] (${guildId}) Failed to refresh DB config: ${String(err)}`);
		}
		try {
			const guild = await client.guilds.fetch(session.guildId);
			const channel = (await guild.channels.fetch(session.textChannelId)) as TextChannel | null;
			if (!channel) return;

			for (const [userId, ustate] of session.users.entries()) {
				// Need at least 0.75s of audio before transcribing
				const bytesAvailable = ustate.buffer.reduce((a, b) => a + b.length, 0);
				const secondsAvailable = bytesAvailable / BYTE_RATE_PER_SECOND;
				if (bytesAvailable < MIN_AUDIO_BYTES) {
					// Avoid repeated logs for the same small buffer – only log when size changes
					if (bytesAvailable !== ustate.lastBytes) {
						container.logger.debug(
							`[TRANSCRIBE] (${guildId}) skipping ${ustate.username} (${userId}) - insufficient audio ${bytesAvailable} bytes (${secondsAvailable.toFixed(3)}s) < ${MIN_AUDIO_SECONDS}s`
						);
						ustate.lastBytes = bytesAvailable;
					}

					// If buffer hasn't changed for a while, clear it to avoid holding a tiny fragment forever
					const now = Date.now();
					const stalenessMs = now - (ustate.lastUpdate || 0);
					if (stalenessMs > 5000 && bytesAvailable > 0) {
						container.logger.debug(
							`[TRANSCRIBE] (${guildId}) clearing stale buffer for ${ustate.username} - bytes=${bytesAvailable}, staleness=${stalenessMs}ms`
						);
						ustate.buffer = [];
						ustate.lastBytes = 0;
					}

					continue;
				}

				// Try to process buffer (this will automatically respect min bytes unless forced by endHandler)
				await processUserBuffer(session, ustate, channel, false);
			}
		} catch (err) {
			container.logger.error(`[TRANSCRIBE] (${guildId}) Transcription session tick error: ${String(err)}`);
		}
		// Schedule next tick
		timer = setTimeout(tick, TRANSCRIBE_INTERVAL_MS);
	};

	// Provide stop method to cancel the tick and clear timer
	session.stop = () => {
		stopped = true;
		if (timer) {
			clearTimeout(timer);
		}
	};

	// Start periodic worker
	tick();

	session.interval = timer;
	sessions.set(guildId, session);
	container.logger.info(`[TRANSCRIBE] (${guildId}) Started transcription session`);
	return session;
}

/**
 * Stop transcription session and cleanup
 */
export async function stopTranscriptionSession(guildId: string) {
	const session = sessions.get(guildId);
	if (!session) return false;

	try {
		if (session.interval) {
			clearTimeout(session.interval);
			container.logger.debug(`[TRANSCRIBE] (${guildId}) cleared interval`);
		}
		if (session.stop) {
			session.stop();
			container.logger.debug(`[TRANSCRIBE] (${guildId}) signalled stop`);
		}
		// Remove speaking handlers
		session.receiver.speaking.removeAllListeners();
		container.logger.debug(`[TRANSCRIBE] (${guildId}) removed speaking listeners`);
		// Destroy decoders
		for (const u of session.users.values()) {
			if (u.decoder) {
				try {
					u.decoder.removeAllListeners();
				} catch {}
				// clear any pending timers
				if (u.pendingTimer) {
					try {
						clearTimeout(u.pendingTimer);
					} catch {}
				}
			}
		}
		// Leave voice channel
		session.voiceConnection.destroy();
		container.logger.debug(`[TRANSCRIBE] (${guildId}) destroyed voice connection`);
	} catch (err) {
		container.logger.error(`[TRANSCRIBE] (${guildId}) Error stopping transcription session: ${String(err)}`);
	}

	sessions.delete(guildId);
	return true;
}

export function isTranscribing(guildId: string) {
	return sessions.has(guildId);
}
