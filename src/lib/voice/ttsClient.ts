import { container } from '@sapphire/framework';

const TTS_URL = process.env.TTS_URL ?? 'http://tts:8000';
const TIMEOUT_MS = 8_000;
/** Tighter than synthesis on purpose: `/assistant status` awaits this inside Discord's 3 s reply window. */
const HEALTH_TIMEOUT_MS = 2_000;
/**
 * Acks are one short sentence. Anything longer is a bug upstream, not something to read out.
 *
 * Exported because the trigger validators reject anything longer rather than let it be
 * silently truncated here — what you typed should be what you hear.
 */
export const MAX_SPOKEN_CHARS = 240;

const MENTION = /<(?:@[!&]?|#)\d+>/g;
const CUSTOM_EMOJI = /<a?:(\w+):\d+>/g;
const URL = /https?:\/\/\S+/g;
const MARKDOWN = /[*_~`|]/g;
const PICTOGRAPH = /\p{Extended_Pictographic}️?/gu;

/**
 * Strips the parts of a Discord message that mean nothing out loud.
 *
 * The ack strings are written for a text channel — `**bold**` titles, a leading status emoji,
 * the odd mention — and a speech synthesiser reads all of that literally ("asterisk asterisk").
 */
export function toSpeech(text: string): string {
	const spoken = text
		.replace(MENTION, '')
		.replace(CUSTOM_EMOJI, '$1')
		.replace(URL, 'a link')
		.replace(PICTOGRAPH, '')
		.replace(MARKDOWN, '')
		.replace(/\s+/g, ' ')
		.trim();
	return spoken.length > MAX_SPOKEN_CHARS ? `${spoken.slice(0, MAX_SPOKEN_CHARS).trimEnd()}…` : spoken;
}

/**
 * Synthesises one acknowledgement.
 *
 * Never throws, and returns `null` rather than an empty buffer when it cannot: the caller
 * falls back to a text ack on `null`, so a dead sidecar costs the spoken reply and nothing
 * else. Same contract as `sttClient.transcribe` for the same reason — this runs off the audio
 * path's promise chain, where an unhandled rejection is one more way to kill the process.
 */
export async function synthesize(text: string): Promise<Uint8Array | null> {
	const input = toSpeech(text);
	if (!input) return null;

	try {
		const response = await fetch(`${TTS_URL}/v1/audio/speech`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ input }),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		if (!response.ok) {
			container.logger.warn(`[voice/tts] sidecar returned ${response.status}`);
			return null;
		}

		const wav = new Uint8Array(await response.arrayBuffer());
		return wav.length ? wav : null;
	} catch (error) {
		container.logger.warn(`[voice/tts] synthesis failed: ${String(error)}`);
		return null;
	}
}

/** Reported by `/assistant status` so a broken sidecar is visible before anyone tries to use it. */
export async function isHealthy(): Promise<boolean> {
	try {
		const response = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
		return response.ok;
	} catch {
		return false;
	}
}
