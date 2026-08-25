import { container } from '@sapphire/framework';
import { SAMPLE_RATE } from './types';

const STT_URL = process.env.STT_URL ?? 'http://stt:8000';
const TIMEOUT_MS = 5_000;

/**
 * Whisper emits these for silence, music and noise. They are not transcription errors, they
 * are what the model says when there is nothing to say — dispatching on them would fire
 * commands at background noise.
 *
 * Matched as whole bracketed tokens. The earlier version of this filter in `recorder.ts`
 * substring-matched the inner word, so it also deleted the word "music" out of real speech.
 */
const HALLUCINATION_PATTERN = /[[(*]\s*(blank_?audio|music|silence|applause|laughter|inaudible|noise|sound)[^\])*]*[\])*]/gi;

/** 16-bit mono PCM WAV around the float samples. Whisper wants a container, not raw PCM. */
function toWav(pcm: Float32Array): Uint8Array<ArrayBuffer> {
	const dataBytes = pcm.length * 2;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // format: PCM
	view.setUint16(22, 1, true); // channels
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);

	for (let i = 0; i < pcm.length; i++) {
		const clamped = Math.max(-1, Math.min(1, pcm[i]));
		view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
	}
	return new Uint8Array(buffer);
}

export function stripHallucinations(text: string): string {
	return text.replace(HALLUCINATION_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Transcribes one bounded utterance.
 *
 * Never throws. A failing sidecar must degrade to "heard nothing" rather than propagate into
 * the audio path, where an unhandled rejection would be one more way to kill the process.
 */
export async function transcribe(pcm: Float32Array): Promise<string> {
	if (pcm.length === 0) return '';

	try {
		const form = new FormData();
		form.append('file', new Blob([toWav(pcm)], { type: 'audio/wav' }), 'utterance.wav');

		const response = await fetch(`${STT_URL}/v1/audio/transcriptions`, {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		if (!response.ok) {
			container.logger.warn(`[voice/stt] sidecar returned ${response.status}`);
			return '';
		}

		const { text } = (await response.json()) as { text?: string };
		return stripHallucinations(text ?? '');
	} catch (error) {
		container.logger.warn(`[voice/stt] transcription failed: ${String(error)}`);
		return '';
	}
}

/** Polled when a session starts, so the failure is reported up front rather than per utterance. */
export async function isHealthy(): Promise<boolean> {
	try {
		const response = await fetch(`${STT_URL}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		return response.ok;
	} catch {
		return false;
	}
}
