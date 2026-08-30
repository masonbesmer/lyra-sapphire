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
 * Plays short clips back through the *listener* connection.
 *
 * Not through Lavalink, deliberately. A trigger sound is an interjection, not a queue entry:
 * routing it through the music player would mean stopping whatever is playing, playing the
 * clip, and restoring position — audible, lossy, and racy against anyone using /play. The
 * listener client already holds its own voice connection in the channel and has no queue to
 * disturb, so a clip mixes in over the music instead of interrupting it.
 */

/** A trigger clip is an interjection. Anything longer is a mistake, so it is cut rather than refused. */
const MAX_PLAYBACK_MS = 10_000;

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
 * Plays one file into the guild's voice channel.
 *
 * Returns false rather than queueing when a clip is already playing: triggers fire off
 * conversation, and a backlog of them would still be draining long after the moment passed.
 */
export async function playSound(guildId: string, filePath: string): Promise<boolean> {
	const connection = getVoiceConnection(guildId, LISTENER_GROUP);
	if (!connection) return false;

	const player = playerFor(guildId);
	if (player.state.status !== AudioPlayerStatus.Idle) return false;

	// Decoded to raw PCM by ffmpeg rather than handed to @discordjs/voice as a file path: the
	// store accepts whatever container Discord served, and probing each one is both slower and
	// one more thing that can throw on the audio path.
	const ffmpeg = spawn(ffmpegPath, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-t',
		(MAX_PLAYBACK_MS / 1000).toFixed(2),
		'-i',
		filePath,
		'-f',
		's16le',
		'-ar',
		'48000',
		'-ac',
		'2',
		'pipe:1'
	]);

	let finished = false;
	const cleanup = () => {
		if (finished) return;
		finished = true;
		ffmpeg.stdout.destroy();
		ffmpeg.kill('SIGKILL');
	};

	ffmpeg.on('error', (error) => {
		container.logger.warn(`[voice/playback] ffmpeg failed for ${filePath}: ${String(error)}`);
		cleanup();
	});
	ffmpeg.stderr.on('data', (chunk: Buffer) => container.logger.warn(`[voice/playback] ffmpeg: ${chunk.toString().trim()}`));
	ffmpeg.stdout.on('error', () => cleanup());

	try {
		const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
		connection.subscribe(player);
		player.play(resource);
	} catch (error) {
		container.logger.warn(`[voice/playback] couldn't start ${filePath}: ${String(error)}`);
		cleanup();
		return false;
	}

	player.once(AudioPlayerStatus.Idle, cleanup);
	return true;
}

/** Called when a session ends, so a clip cannot outlive the connection it is playing through. */
export function stopPlayback(guildId: string): void {
	const player = players.get(guildId);
	if (!player) return;
	player.stop(true);
	players.delete(guildId);
}
