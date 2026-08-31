import { spawn } from 'node:child_process';
import {
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	getVoiceConnection,
	NoSubscriberBehavior,
	StreamType,
	type AudioPlayer
} from '@discordjs/voice';
import { container } from '@sapphire/framework';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { LISTENER_GROUP } from './listenerClient';

/**
 * Speaks back through the *listener* connection.
 *
 * Not through Lavalink, deliberately. An ack is an interjection, not a queue entry: routing it
 * through the music player would mean stopping whatever is playing, speaking, and restoring
 * position — audible, lossy, and racy against anyone using /play. The listener client already
 * holds its own voice connection in the channel and has no queue to disturb, so speech mixes
 * in over the music instead of interrupting it.
 */

/** A spoken ack is a sentence, and the text is capped before synthesis; this is the runaway backstop. */
const MAX_SPEECH_MS = 30_000;

const players = new Map<string, AudioPlayer>();

function playerFor(guildId: string): AudioPlayer {
	const existing = players.get(guildId);
	if (existing) return existing;

	const player = createAudioPlayer({
		// The listener is the only subscriber and it never goes away mid-clip; pausing on an
		// empty subscriber list would just strand the resource.
		behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
	});
	// AudioPlayer is an EventEmitter: an unhandled 'error' is a fatal exception, and a broken
	// clip must not be able to take the bot down.
	player.on('error', (error) => container.logger.warn(`[voice/playback] player error in ${guildId}: ${String(error)}`));
	players.set(guildId, player);
	return player;
}

/**
 * Starts one ffmpeg-decoded source on the guild's player.
 *
 * Everything is decoded to raw PCM by ffmpeg rather than handed to @discordjs/voice to probe:
 * the sound store accepts whatever container Discord served and the TTS sidecar answers in
 * WAV at the voice's own sample rate, so probing each one is both slower and one more thing
 * that can throw on the audio path.
 *
 * Returns false rather than queueing when something is already playing. Both callers have a
 * better answer than a backlog — a trigger that fires late has missed its moment, and an ack
 * that cannot be spoken is sent as text instead.
 *
 * `stdin` is for a source that arrives as bytes rather than a path. It is always a complete
 * buffer, so it is written and closed in one go.
 */
async function start(guildId: string, source: string, input: string[], stdin?: Uint8Array): Promise<boolean> {
	const connection = getVoiceConnection(guildId, LISTENER_GROUP);
	if (!connection) return false;

	const player = playerFor(guildId);
	if (player.state.status !== AudioPlayerStatus.Idle) return false;

	const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...input, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1']);

	let finished = false;
	const cleanup = () => {
		if (finished) return;
		finished = true;
		ffmpeg.stdout.destroy();
		ffmpeg.kill('SIGKILL');
	};

	ffmpeg.on('error', (error) => {
		container.logger.warn(`[voice/playback] ffmpeg failed for ${source}: ${String(error)}`);
		cleanup();
	});
	ffmpeg.stderr.on('data', (chunk: Buffer) => container.logger.warn(`[voice/playback] ffmpeg: ${chunk.toString().trim()}`));
	ffmpeg.stdout.on('error', () => cleanup());
	if (stdin) {
		// Also an EventEmitter, and ffmpeg exiting early makes this throw EPIPE.
		ffmpeg.stdin.on('error', (error) => container.logger.warn(`[voice/playback] ffmpeg stdin for ${source}: ${String(error)}`));
		ffmpeg.stdin.end(Buffer.from(stdin));
	}

	try {
		const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
		connection.subscribe(player);
		player.play(resource);
	} catch (error) {
		container.logger.warn(`[voice/playback] couldn't start ${source}: ${String(error)}`);
		cleanup();
		return false;
	}

	player.once(AudioPlayerStatus.Idle, cleanup);
	return true;
}

/**
 * Speaks a synthesised acknowledgement into the guild's voice channel.
 *
 * One player per guild, never two: a VoiceConnection holds a single subscription, so a second
 * player would push packets down the same socket and arrive as interleaved noise.
 */
export function playSpeech(guildId: string, wav: Uint8Array): Promise<boolean> {
	return start(guildId, 'a spoken ack', ['-t', (MAX_SPEECH_MS / 1000).toFixed(2), '-i', 'pipe:0'], wav);
}

/** Called when a session ends, so speech cannot outlive the connection it is playing through. */
export function stopPlayback(guildId: string): void {
	const player = players.get(guildId);
	if (!player) return;
	player.stop(true);
	players.delete(guildId);
}
