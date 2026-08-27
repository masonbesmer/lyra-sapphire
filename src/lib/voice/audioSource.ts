import { spawn } from 'node:child_process';
import { EndBehaviorType, type VoiceReceiver } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import { OpusEncoder } from '@discordjs/opus';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { FRAME_BYTES, FRAME_SAMPLES, SAMPLE_RATE } from './types';

export type FrameHandler = (pcm: Float32Array) => void;

export interface AudioSource {
	destroy(): void;
}

/**
 * Emits fixed 80 ms frames of 16 kHz mono float32 for one user.
 *
 * Built on `/record`'s proven subscribe/decode path, but resampling through ffmpeg rather than
 * in JS: 48k -> 16k is exactly 3:1, and the hand-rolled helper this replaces decimated without
 * an anti-alias filter, folding everything above 8 kHz into the speech band. ffmpeg filters
 * properly and is already a dependency.
 *
 * Deliberately omits `/record`'s silence-gap insertion — that keeps multi-track recordings
 * time-aligned for mixing, which the assistant does not need. VAD handles gaps.
 */
export function createUserAudioSource(receiver: VoiceReceiver, userId: string, onFrame: FrameHandler): AudioSource {
	const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
	// Decoded packet-at-a-time rather than through prism's Transform on purpose. A Transform
	// that throws in _transform is destroyed by Node, and @discordjs/voice hands us packets it
	// could not E2EE-decrypt as-is (DAVE passes ciphertext straight through until its MLS
	// session is ready), so a single such packet at join time would kill this user's decoder —
	// and with it every later frame — for the rest of the session. Dropping the bad packet and
	// carrying on is the only behaviour that survives a DAVE channel.
	const decoder = new OpusEncoder(48_000, 2);

	const ffmpeg = spawn(ffmpegPath, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-f',
		's16le',
		'-ar',
		'48000',
		'-ac',
		'2',
		'-i',
		'pipe:0',
		'-f',
		'f32le',
		'-ar',
		String(SAMPLE_RATE),
		'-ac',
		'1',
		'pipe:1'
	]);

	let destroyed = false;
	// ffmpeg emits arbitrary chunk sizes; the models need exactly FRAME_SAMPLES each time.
	let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);

	// Every one of these is an EventEmitter, and an unhandled 'error' is a fatal exception.
	// That has already taken this bot down once.
	const warn = (what: string) => (error: unknown) => {
		if (!destroyed) container.logger.warn(`[voice/audio] ${what} for ${userId}: ${String(error)}`);
	};
	opusStream.on('error', warn('opus stream'));
	ffmpeg.on('error', warn('ffmpeg'));
	ffmpeg.stdin.on('error', warn('ffmpeg stdin'));
	ffmpeg.stderr.on('data', (chunk: Buffer) => warn('ffmpeg')(chunk.toString().trim()));

	opusStream.on('data', (packet: Buffer) => {
		if (destroyed) return;
		let pcm: Buffer;
		try {
			pcm = decoder.decode(packet);
		} catch (error) {
			warn('decoder')(error);
			return;
		}
		ffmpeg.stdin.write(pcm);
	});

	ffmpeg.stdout.on('data', (chunk: Buffer) => {
		carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
		let offset = 0;
		while (carry.length - offset >= FRAME_BYTES) {
			// Copy: the worker transfers the underlying ArrayBuffer, so frames cannot share
			// a backing store with each other or with `carry`.
			const frame = new Float32Array(FRAME_SAMPLES);
			Buffer.from(frame.buffer).set(carry.subarray(offset, offset + FRAME_BYTES));
			offset += FRAME_BYTES;
			onFrame(frame);
		}
		// Copy the remainder rather than subarray-ing it: a subarray keeps the whole original
		// chunk's backing store alive for the sake of a few hundred bytes.
		carry = offset ? Buffer.from(carry.subarray(offset)) : carry;
	});

	return {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			opusStream.destroy();
			ffmpeg.stdin.end();
			ffmpeg.kill('SIGKILL');
			carry = Buffer.alloc(0);
		}
	};
}

/**
 * Keeps one `createUserAudioSource` per eligible speaker in a channel, including people who
 * join after the session starts.
 *
 * `isAllowed` is checked *before* subscribing, never after. An opted-out user's stream must
 * never be subscribed to, not merely ignored downstream.
 */
export function createChannelAudioSource(
	receiver: VoiceReceiver,
	initialUserIds: Iterable<string>,
	isAllowed: (userId: string) => boolean,
	onFrame: (userId: string, pcm: Float32Array) => void
): AudioSource {
	const sources = new Map<string, AudioSource>();

	const add = (userId: string) => {
		if (sources.has(userId) || !isAllowed(userId)) return;
		try {
			sources.set(
				userId,
				createUserAudioSource(receiver, userId, (pcm) => onFrame(userId, pcm))
			);
		} catch (error) {
			container.logger.error(`[voice/audio] failed to open source for ${userId}: ${String(error)}`);
		}
	};

	for (const userId of initialUserIds) add(userId);

	// Catches anyone who joins or unmutes mid-session, the way recordAllUsers does.
	const onSpeaking = (userId: string) => add(userId);
	receiver.speaking.on('start', onSpeaking);

	return {
		destroy() {
			receiver.speaking.off('start', onSpeaking);
			for (const source of sources.values()) source.destroy();
			sources.clear();
		}
	};
}
