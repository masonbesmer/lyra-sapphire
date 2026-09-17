import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { container } from '@sapphire/framework';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import { getVoiceAssistantConfig, isVoiceOptedOut, logVoiceCommand } from '../config';
import { createChannelAudioSource, type AudioSource } from './audioSource';
import { ensureReceiveConnection, releaseReceiveConnection } from './connection';
import { dispatch, reportUnknownCommand } from './dispatch';
import { getMusicClient } from './musicClient';
import { parse } from './intents';
import { transcribe } from './sttClient';
import { playChime, stopPlayback } from './playback';
import { parseStreamKey, streamKey, type FromWorkerMessage, type StreamKey } from './types';

interface AssistantSession {
	guildId: string;
	voiceChannelId: string;
	textChannelId: string | null;
	audio: AudioSource;
	registered: Set<StreamKey>;
	/** Users whose utterance is still being transcribed. A second wake is dropped, not queued. */
	inFlight: Set<string>;
}

const sessions = new Map<string, AssistantSession>();

// One worker for the whole process: the models are a few MB and inference is sub-millisecond,
// so a single worker multiplexes every guild and user cheaply.
let worker: Worker | null = null;
let workerReady = false;

export function isAssistantActive(guildId: string): boolean {
	return sessions.has(guildId);
}

/** The channel Lyra is listening in, or null when she isn't listening in this guild. */
export function getAssistantChannelId(guildId: string): string | null {
	return sessions.get(guildId)?.voiceChannelId ?? null;
}

function ensureWorker(): Worker {
	if (worker) return worker;

	const wakeWord = process.env.VOICE_WAKE_WORD ?? 'hey_jarvis_v0.1';
	worker = new Worker(join(__dirname, 'detectWorker.js'), {
		workerData: { modelsDir: process.env.VOICE_MODELS_DIR ?? './models', wakeModel: wakeWord }
	});

	worker.on('message', (message: FromWorkerMessage) => {
		if (message.type === 'ready') {
			workerReady = true;
			container.logger.info(`[voice/session] detection worker ready (${wakeWord})`);
			return;
		}
		if (message.type === 'error') {
			container.logger.error(`[voice/session] worker error${message.key ? ` for ${message.key}` : ''}: ${message.message}`);
			return;
		}
		if (message.type === 'wake') {
			container.logger.debug(`[voice/session] wake ${message.key} score=${message.score.toFixed(3)}`);
			void onWake(message.key);
			return;
		}
		if (message.type === 'diag') {
			container.logger.warn(`[voice/session] ${message.key}: ${message.message}`);
			return;
		}
		void onUtterance(message.key, message.pcm, message.durationMs);
	});

	// A dead worker must not take the bot with it, and must not leave sessions believing
	// detection is still running.
	worker.on('error', (error) => {
		container.logger.error(`[voice/session] detection worker crashed: ${String(error)}`);
		worker = null;
		workerReady = false;
	});
	worker.on('exit', () => {
		worker = null;
		workerReady = false;
	});

	return worker;
}

/**
 * Marks a wake hit audibly, so the speaker knows to start talking.
 *
 * Fired the moment the wake word lands rather than after the command: the whole point is to
 * tell someone they are being heard *before* they speak, and the capture is already running by
 * the time this plays, so the chime cannot eat the start of their command.
 */
async function onWake(key: StreamKey) {
	const { guildId } = parseStreamKey(key);
	if (!sessions.has(guildId)) return;
	if (!getVoiceAssistantConfig(guildId).wake_chime) return;

	// Best-effort by design: a chime that cannot play (nothing to play through, or an ack still
	// speaking) is never a reason to drop the command that follows it.
	try {
		await playChime(guildId);
	} catch (error) {
		container.logger.warn(`[voice/session] wake chime failed for ${key}: ${String(error)}`);
	}
}

async function onUtterance(key: StreamKey, pcm: Float32Array, durationMs: number) {
	const { guildId, userId } = parseStreamKey(key);
	const session = sessions.get(guildId);
	if (!session) return;
	if (session.inFlight.has(userId)) {
		container.logger.debug(`[voice/session] dropping utterance for ${key}; one is already in flight`);
		return;
	}

	session.inFlight.add(userId);
	try {
		// Empty when STT could make nothing of the capture. Not an early return any more: the wake
		// word fired, so somebody spoke to Lyra and gets an answer either way.
		const transcript = await transcribe(pcm);

		container.logger.info(`[voice/session] ${key} (${durationMs.toFixed(0)}ms): ${transcript || '<nothing transcribed>'}`);

		const parsed = transcript ? parse(transcript) : null;
		if (!parsed) {
			// Answered, not dropped. Overheard conversation never gets this far — the wake word
			// gates the whole path — so whoever spoke was talking to Lyra, and silence here is
			// indistinguishable from her having missed them entirely.
			logVoiceCommand({ guildId, userId, transcript });
			await reportUnknownCommand(guildId, userId, transcript, session.textChannelId);
			return;
		}

		await dispatch(guildId, userId, parsed, transcript, session.textChannelId);
	} catch (error) {
		container.logger.error(`[voice/session] failed to handle utterance for ${key}: ${String(error)}`);
	} finally {
		session.inFlight.delete(userId);
	}
}

/**
 * The worker settings a stream is registered with.
 *
 * Read fresh on every registration rather than closed over once: a session outlives a
 * dashboard change, and someone who joins after one must get the settings the guild is
 * actually on.
 */
function detectorConfig(guildId: string): { sensitivity: number; silenceMs: number; maxMs: number } {
	const config = getVoiceAssistantConfig(guildId);
	return {
		sensitivity: config.sensitivity,
		silenceMs: config.silence_ms,
		maxMs: config.max_utterance_ms
	};
}

export type StartResult = { ok: true } | { ok: false; error: string };

export async function startAssistantSession(guild: Guild, voiceChannel: VoiceBasedChannel, textChannelId: string | null): Promise<StartResult> {
	if (sessions.has(guild.id)) return { ok: false, error: "I'm already listening in this server." };

	// Both features on one bot means one gateway voice state, and Lavalink already owns it:
	// the join below would sit there for 20s and come back as a bare AbortError. Name the
	// actual cause instead.
	if (!getMusicClient() && container.client.kazagumo.getPlayer(guild.id)) {
		return {
			ok: false,
			error: "I can't listen while I'm playing music — the music bot's token isn't configured, so both are fighting over one voice state."
		};
	}

	const config = getVoiceAssistantConfig(guild.id);
	const detector = ensureWorker();

	let connection;
	try {
		connection = await ensureReceiveConnection(guild.id, voiceChannel.id);
	} catch (error) {
		return { ok: false, error: `couldn't join to listen: ${String(error)}` };
	}

	const registered = new Set<StreamKey>();
	const eligible = (userId: string) => {
		const member = voiceChannel.members.get(userId);
		if (member?.user.bot) return false;
		return !isVoiceOptedOut(guild.id, userId);
	};

	const audio = createChannelAudioSource(connection.receiver, [...voiceChannel.members.keys()], eligible, (userId, pcm) => {
		if (!workerReady) return;
		const key = streamKey(guild.id, userId);
		// Registered lazily, so users who join mid-session are picked up without a
		// separate code path.
		if (!registered.has(key)) {
			registered.add(key);
			detector.postMessage({ type: 'register', key });
			detector.postMessage({ type: 'config', key, ...detectorConfig(guild.id) });
		}
		detector.postMessage({ type: 'frame', key, pcm });
	});

	sessions.set(guild.id, {
		guildId: guild.id,
		voiceChannelId: voiceChannel.id,
		textChannelId: textChannelId ?? config.text_channel_id,
		audio,
		registered,
		inFlight: new Set()
	});

	// Announcing is a privacy requirement, not a nicety: people in the channel are being
	// listened to and must be told.
	const announceId = textChannelId ?? config.text_channel_id;
	if (announceId) {
		const channel = container.client.channels.cache.get(announceId);
		if (channel?.isTextBased() && 'send' in channel) {
			await channel
				.send(
					`🎧 I'm listening in **${voiceChannel.name}** now. Say the wake word if you want something. Not into it? \`/assistant optout\` any time.`
				)
				.catch(() => null);
		}
	}

	return { ok: true };
}

export async function stopAssistantSession(guildId: string): Promise<void> {
	const session = sessions.get(guildId);
	if (!session) return;
	sessions.delete(guildId);

	session.audio.destroy();
	if (worker) for (const key of session.registered) worker.postMessage({ type: 'unregister', key });

	// Playback must not outlive the connection it plays through.
	stopPlayback(guildId);

	// Safe unconditionally: music runs on the second client's gateway voice state, so leaving
	// cannot disconnect the music bot or stop playback.
	releaseReceiveConnection(guildId);
}
