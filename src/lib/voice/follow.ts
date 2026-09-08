import { container } from '@sapphire/framework';
import type { VoiceBasedChannel } from 'discord.js';
import { getVoiceAssistantConfig, isVoiceFollowEnabled } from '../config';
import { isAssistantActive, startAssistantSession } from './session';

/** Pending joins, keyed by guild and member: one follower can only be waited on once. */
const pending = new Map<string, NodeJS.Timeout>();

const pendingKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

/**
 * Arms a delayed join for a member who has follow turned on.
 *
 * The delay exists because people bounce between channels: joining the instant someone
 * appears means following them straight back out again. Nothing happens if Lyra is already
 * listening — following is about joining when she isn't there, never about dragging her out
 * of a channel she is already in.
 */
export function scheduleFollowJoin(channel: VoiceBasedChannel, userId: string): void {
	const guildId = channel.guild.id;
	if (isAssistantActive(guildId)) return;
	if (!isVoiceFollowEnabled(guildId, userId)) return;

	// A member who hops channels re-arms rather than stacking a second timer.
	cancelFollowJoin(guildId, userId);

	const delayMs = Math.max(0, getVoiceAssistantConfig(guildId).follow_delay_ms);
	const key = pendingKey(guildId, userId);
	const timer = setTimeout(() => {
		pending.delete(key);
		void joinNow(channel, userId);
	}, delayMs);
	timer.unref();
	pending.set(key, timer);
}

/** Drops a pending join — the member left, or moved on, before the delay elapsed. */
export function cancelFollowJoin(guildId: string, userId: string): void {
	const key = pendingKey(guildId, userId);
	const timer = pending.get(key);
	if (!timer) return;
	clearTimeout(timer);
	pending.delete(key);
}

async function joinNow(channel: VoiceBasedChannel, userId: string): Promise<void> {
	const guildId = channel.guild.id;
	// Everything checked before the wait is re-checked after it: another follower may have
	// pulled Lyra in already, and this one may have left in the meantime.
	if (isAssistantActive(guildId)) return;
	if (!isVoiceFollowEnabled(guildId, userId)) return;
	// Voice states rather than the member cache: this only cares where they are sitting now.
	if (channel.guild.voiceStates.cache.get(userId)?.channelId !== channel.id) return;

	const result = await startAssistantSession(channel.guild, channel, getVoiceAssistantConfig(guildId).text_channel_id);
	if (result.ok) {
		container.logger.info(`[voice/follow] ${guildId}: followed ${userId} into ${channel.id}`);
		return;
	}
	container.logger.warn(`[voice/follow] ${guildId}: couldn't follow ${userId} into ${channel.id}: ${result.error}`);
}
