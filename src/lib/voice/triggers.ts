import { container } from '@sapphire/framework';
import { getVoiceWordTriggers, logVoiceTrigger, type VoiceWordTrigger } from '../config';
import { playSound, playSpeech } from './playback';
import { soundPath } from './sounds';
import { synthesize } from './ttsClient';

/**
 * Spoken word triggers: a keyword said out loud in the voice channel, matched against the
 * transcript of an utterance nobody addressed to the bot.
 */

/** Floor on the per-trigger cooldown. Below this a repeated word is a stutter, not two events. */
export const MIN_COOLDOWN_MS = 1_000;
export const MAX_COOLDOWN_MS = 3_600_000;
export const DEFAULT_COOLDOWN_MS = 30_000;

/** Last fire time per `guild:keyword`. In-memory: a cooldown that survives a restart isn't worth a table. */
const lastFired = new Map<string, number>();

/**
 * Splits into comparable words.
 *
 * Whisper punctuates and capitalises; neither matters here. Apostrophes are kept so "don't"
 * stays one token and can be written as one in a keyword.
 */
function tokenise(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9'\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * Whole-word containment, rather than the substring match the chat triggers use.
 *
 * A transcript is generated text with no author to blame for a near miss, so a keyword like
 * "ass" matching inside "class" is not a funny edge case, it is the common case. Multi-word
 * keywords match as a consecutive run.
 */
export function containsPhrase(haystack: string[], needle: string[]): boolean {
	if (needle.length === 0 || needle.length > haystack.length) return false;
	for (let i = 0; i + needle.length <= haystack.length; i++) {
		let matched = true;
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
}

/**
 * Every trigger the transcript contains, longest keyword first.
 *
 * Longest first so an utterance matching both "deploy" and "deploy to prod" answers with the
 * more specific of the two.
 */
export function matchTriggers(triggers: VoiceWordTrigger[], transcript: string): VoiceWordTrigger[] {
	const words = tokenise(transcript);
	if (words.length === 0) return [];

	return triggers.filter((trigger) => containsPhrase(words, tokenise(trigger.keyword))).sort((a, b) => b.keyword.length - a.keyword.length);
}

function offCooldown(guildId: string, trigger: VoiceWordTrigger, now: number): boolean {
	const key = `${guildId}:${trigger.keyword}`;
	const previous = lastFired.get(key);
	const cooldown = Math.max(MIN_COOLDOWN_MS, trigger.cooldown_ms);
	if (previous !== undefined && now - previous < cooldown) return false;
	lastFired.set(key, now);
	return true;
}

/** Dropped when a session ends, so an old cooldown can't mute the first trigger of the next one. */
export function clearCooldowns(guildId: string): void {
	for (const key of lastFired.keys()) if (key.startsWith(`${guildId}:`)) lastFired.delete(key);
}

async function respond(guildId: string, userId: string, trigger: VoiceWordTrigger, textChannelId: string | null): Promise<boolean> {
	if (trigger.response_type === 'sound') {
		const path = soundPath(guildId, trigger.response);
		if (!path) {
			container.logger.warn(`[voice/triggers] ${guildId}: trigger "${trigger.keyword}" points at missing sound "${trigger.response}"`);
			return false;
		}
		return playSound(guildId, path);
	}

	if (trigger.response_type === 'speak') {
		// No fallback to a text reply, deliberately: `text` is a response type someone can pick
		// on purpose, so quietly becoming it would misrepresent what they configured. A dead
		// sidecar shows up as a trigger that did not dispatch, same as a missing clip.
		const wav = await synthesize(trigger.response);
		return wav ? playSpeech(guildId, wav) : false;
	}

	if (!textChannelId) return false;
	const channel = container.client.channels.cache.get(textChannelId);
	if (!channel?.isTextBased() || !('send' in channel)) return false;

	// The speaker is named because the message otherwise arrives with no explanation of why
	// the bot suddenly said something — nobody typed anything.
	const sent = await channel.send({
		content: `<@${userId}> ${trigger.response}`,
		// A trigger fires off overheard speech, so it must not be able to ping a role or
		// @everyone on a transcription error. The speaker's own mention is still resolved.
		allowedMentions: { users: [userId] }
	});
	return sent !== null;
}

/**
 * Handles one overheard utterance.
 *
 * At most one trigger fires per utterance. Saying a sentence that happens to contain three
 * keywords should not produce three responses, and the alternative — firing them all — turns
 * a single unlucky transcript into a wall of replies.
 */
export async function handleVoiceTriggers(guildId: string, userId: string, transcript: string, textChannelId: string | null): Promise<void> {
	const triggers = getVoiceWordTriggers(guildId);
	if (triggers.length === 0) return;

	const matches = matchTriggers(triggers, transcript);
	if (matches.length === 0) return;

	const now = Date.now();
	// Cooldowns are checked in match order so a suppressed specific trigger doesn't hand the
	// utterance to a broader one that would otherwise have lost.
	const trigger = matches.find((candidate) => offCooldown(guildId, candidate, now));
	if (!trigger) return;

	try {
		const responded = await respond(guildId, userId, trigger, textChannelId);
		logVoiceTrigger({ guildId, userId, keyword: trigger.keyword, dispatched: responded });
		if (responded) container.logger.debug(`[voice/triggers] ${guildId}: fired "${trigger.keyword}" (${trigger.response_type})`);
	} catch (error) {
		container.logger.error(`[voice/triggers] ${guildId}: "${trigger.keyword}" failed: ${String(error)}`);
		logVoiceTrigger({ guildId, userId, keyword: trigger.keyword, dispatched: false });
	}
}
