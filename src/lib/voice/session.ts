import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { container } from '@sapphire/framework';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import { getVoiceAssistantConfig, isVoiceOptedOut, logVoiceCommand } from '../config';
import { createChannelAudioSource, type AudioSource } from './audioSource';
import { ensureReceiveConnection, releaseReceiveConnection } from './connection';
import { dispatch } from './dispatch';
import { parse } from './intents';
import { transcribe } from './sttClient';
import { stopPlayback } from './playback';
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
		const transcript = await transcribe(pcm);
		if (!transcript) return;

		container.logger.info(`[voice/session] ${key} (${durationMs.toFixed(0)}ms): ${transcript}`);

		const parsed = parse(transcript);
		if (!parsed) {
			// Deliberately silent. A chatty assistant that misfires on overheard conversation
			// is worse than one that occasionally misses, so unrecognised speech is logged and
			// dropped rather than answered.
			logVoiceCommand({ guildId, userId, transcript });
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
