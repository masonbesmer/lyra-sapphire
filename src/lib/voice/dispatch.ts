import { container } from '@sapphire/framework';
import { getVoiceAssistantConfig, logVoiceCommand, type VoiceAssistantConfig } from '../config';
import { checkDJPermission } from '../music';
import * as musicActions from '../musicActions';
import type { ActionResult } from '../musicActions';
import type { ParsedIntent } from './intents';
import { playSpeech } from './playback';
import { synthesize } from './ttsClient';

/** Above this we act silently; below it we name what we heard so a misfire is visible. */
const SILENT_DISPATCH_CONFIDENCE = 0.8;
const RELATIVE_VOLUME_STEP = 10;

async function send(channelId: string | null, content: string): Promise<void> {
	if (!channelId) return;
	const channel = container.client.channels.cache.get(channelId);
	if (channel?.isTextBased() && 'send' in channel) await channel.send(content).catch(() => null);
}

/** Synthesise, then play through the listener. `false` means "put it in the text channel instead". */
async function speak(guildId: string, text: string): Promise<boolean> {
	const wav = await synthesize(text);
	return wav ? playSpeech(guildId, wav) : false;
}

/**
 * Answers however the guild asked to be answered.
 *
 * `tts` degrades to text rather than to silence when the sidecar is down or the listener
 * cannot speak: someone who just talked to the bot needs to know it heard them, and no reply
 * at all is indistinguishable from the wake word having missed.
 */
async function ack(guildId: string, mode: VoiceAssistantConfig['ack_mode'], channelId: string | null, text: string, spoken: string): Promise<void> {
	if (mode === 'none') return;
	if (mode === 'tts' && (await speak(guildId, spoken))) return;
	await send(channelId, text);
}

async function run(guildId: string, userId: string, parsed: ParsedIntent): Promise<ActionResult<unknown>> {
	const { intent, slots } = parsed;
	switch (intent) {
		case 'play': {
			const member = container.client.guilds.cache.get(guildId)?.members.cache.get(userId);
			const voiceChannelId = member?.voice.channelId;
			if (!member || !voiceChannelId) return { ok: false, error: 'get in a voice channel first.', code: 'bad_input' };
			// The raw slot text goes straight to search — the YouTube/YouTube Music fallback
			// copes with imperfect transcriptions surprisingly well.
			return musicActions.play(guildId, member, slots.query, voiceChannelId);
		}
		case 'skip':
			return musicActions.skip(guildId);
		case 'pause':
			return musicActions.pause(guildId, true);
		case 'resume':
			return musicActions.pause(guildId, false);
		case 'stop':
			return musicActions.stop(guildId);
		case 'volume_set':
			return musicActions.setVolume(guildId, Number(slots.n));
		case 'volume_rel': {
			const current = musicActions.currentVolume(guildId);
			if (current === null) return { ok: false, error: "nothing's playing right now.", code: 'no_player' };
			const up = slots.dir === 'up' || slots.dir === 'louder';
			const next = Math.max(1, Math.min(100, current + (up ? RELATIVE_VOLUME_STEP : -RELATIVE_VOLUME_STEP)));
			return musicActions.setVolume(guildId, next);
		}
		case 'shuffle':
			return musicActions.shuffle(guildId);
		case 'nowplaying':
			return musicActions.nowPlaying(guildId);
		case 'queue':
			return musicActions.queueSummary(guildId);
		case 'disconnect':
			return musicActions.stop(guildId);
	}
}

/**
 * Runs a parsed intent on behalf of the speaker.
 *
 * Authorisation is evaluated as the *speaker*, never as the bot. Voice must not become a way
 * around DJOnly: if someone cannot skip with the slash command, saying it out loud must not
 * work either.
 */
export async function dispatch(
	guildId: string,
	userId: string,
	parsed: ParsedIntent,
	transcript: string,
	textChannelId: string | null
): Promise<void> {
	const config = getVoiceAssistantConfig(guildId);
	const guild = container.client.guilds.cache.get(guildId);
	const member = guild?.members.cache.get(userId) ?? (await guild?.members.fetch(userId).catch(() => null)) ?? null;

	const deny = async (reason: string) => {
		logVoiceCommand({ guildId, userId, transcript, intent: parsed.intent, confidence: parsed.confidence, dispatched: false });
		// The text form addresses the speaker by mention; spoken, that is a string of digits,
		// so the display name stands in for it.
		await ack(guildId, config.ack_mode, textChannelId, `🚫 <@${userId}> ${reason}`, member ? `${member.displayName} ${reason}` : reason);
	};

	if (!member) return deny("couldn't find you in this server.");

	// Mirrors the InVoiceWithBot precondition: you have to be where the bot is playing.
	const botChannelId = guild?.members.me?.voice.channelId ?? null;
	if (botChannelId && member.voice.channelId !== botChannelId) {
		return deny("isn't in the voice channel with me.");
	}

	if (config.require_dj && !checkDJPermission(member, guildId)) {
		return deny('needs the DJ role for that.');
	}

	let result: ActionResult<unknown>;
	try {
		result = await run(guildId, userId, parsed);
	} catch (error) {
		container.logger.error(`[voice/dispatch] ${parsed.intent} failed for ${guildId}:${userId}: ${String(error)}`);
		result = { ok: false, error: 'that blew up on my end, check the logs.', code: 'internal' };
	}

	logVoiceCommand({ guildId, userId, transcript, intent: parsed.intent, confidence: parsed.confidence, dispatched: result.ok });

	const uncertain = parsed.confidence < SILENT_DISPATCH_CONFIDENCE;
	const message = result.ok ? result.message : result.error;
	const text = `${result.ok ? '✅' : '⚠️'} ${message}${uncertain ? ` _(heard: "${parsed.normalised}")_` : ''}`;
	await ack(guildId, config.ack_mode, textChannelId, text, `${message}${uncertain ? ` I heard "${parsed.normalised}".` : ''}`);
}
