/**
 * Google Cloud Speech-to-Text and Text-to-Speech over REST, authenticated with a plain API key.
 *
 * The key needs the Cloud Speech-to-Text and Cloud Text-to-Speech APIs enabled on its project.
 * Both calls throw on failure: the sidecar clients wrap them and fall back to the local sidecar,
 * so the never-throw contract lives there, not here.
 */

const STT_URL = 'https://speech.googleapis.com/v1/speech:recognize';
const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const TIMEOUT_MS = 8_000;

async function post<T>(url: string, apiKey: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		// The key goes in a header, never the URL, so it cannot end up in a log line.
		headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) {
		// Google's error body names the API or quota at fault; it never echoes the key.
		const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
		throw new Error(`${new URL(url).host} returned ${response.status}: ${detail}`);
	}
	return (await response.json()) as T;
}

/** Transcribes a 16-bit mono WAV. Empty string when Google heard no speech. */
export async function googleRecognize(apiKey: string, wav: Uint8Array, languageCode: string): Promise<string> {
	const result = await post<{ results?: Array<{ alternatives?: Array<{ transcript?: string }> }> }>(STT_URL, apiKey, {
		// WAV carries its own encoding and sample rate in the header.
		config: { languageCode, model: 'latest_short', enableAutomaticPunctuation: false },
		audio: { content: Buffer.from(wav).toString('base64') }
	});
	return (result.results ?? [])
		.map((part) => part.alternatives?.[0]?.transcript ?? '')
		.join(' ')
		.trim();
}

/** The language a voice speaks, read off its name: `en-US-Neural2-F` → `en-US`. */
export function voiceLanguage(voice: string): string {
	return voice.split('-').slice(0, 2).join('-');
}

/** Synthesises `text` as a WAV (LINEAR16 comes back with a RIFF header). */
export async function googleSynthesize(apiKey: string, text: string, voice: string): Promise<Uint8Array> {
	const result = await post<{ audioContent?: string }>(TTS_URL, apiKey, {
		input: { text },
		voice: { languageCode: voiceLanguage(voice), name: voice },
		audioConfig: { audioEncoding: 'LINEAR16' }
	});
	return new Uint8Array(Buffer.from(result.audioContent ?? '', 'base64'));
}
