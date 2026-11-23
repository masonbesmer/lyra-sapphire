/**
 * Voice search: a Gemini answer grounded in live Google Search, billed to the guild's own
 * Gemini key from the dashboard. Never throws: it runs on the utterance path, so a failed
 * lookup costs one answer.
 */

import { container } from '@sapphire/framework';
import { getGoogleApiKey } from '../config';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 15_000;
const ANSWER_MAX = 500;

interface GeminiResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> };
	}>;
}

/** True when the guild saved a Gemini key. */
export function geminiConfigured(guildId: string): boolean {
	return Boolean(getGoogleApiKey(guildId));
}

/** Strips the markdown a model adds anyway, since the answer may be spoken verbatim. */
function plain(text: string): string {
	const flat = text
		.replace(/[*_`#>]+/g, '')
		.replace(/\[(.+?)\]\(.+?\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	return flat.length > ANSWER_MAX ? `${flat.slice(0, ANSWER_MAX).replace(/\s\S*$/, '')}…` : flat;
}

/** A Google-written answer grounded in live Search results. Null when it said nothing, `'error'` on failure. */
export async function googleAnswer(guildId: string, query: string): Promise<{ answer: string; url?: string } | null | 'error'> {
	const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
	try {
		const response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
			method: 'POST',
			// The key goes in a header, never the URL, so it cannot end up in a log line.
			headers: { 'content-type': 'application/json', 'x-goog-api-key': getGoogleApiKey(guildId) },
			body: JSON.stringify({
				systemInstruction: {
					parts: [{ text: 'Answer in at most three short plain sentences that sound natural read aloud. No markdown, lists or URLs.' }]
				},
				contents: [{ role: 'user', parts: [{ text: query }] }],
				tools: [{ google_search: {} }]
			}),
			signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
		});
		if (!response.ok) {
			// The error body names the quota or model at fault; it never echoes the key.
			const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
			container.logger.warn(`[voice/search] gemini (${model}) returned ${response.status}: ${detail}`);
			return 'error';
		}
		const candidate = ((await response.json()) as GeminiResponse).candidates?.[0];
		const answer = plain((candidate?.content?.parts ?? []).map((part) => part.text ?? '').join(' '));
		if (!answer) return null;
		return { answer, url: candidate?.groundingMetadata?.groundingChunks?.find((chunk) => chunk.web?.uri)?.web?.uri };
	} catch (error) {
		container.logger.warn(`[voice/search] gemini request failed: ${String(error)}`);
		return 'error';
	}
}
