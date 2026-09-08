import { container } from '@sapphire/framework';
import type { KazagumoPlayer } from 'kazagumo';
import { getMusicConfig } from './config';

/** Pending idle disconnects, one per guild. */
const pending = new Map<string, NodeJS.Timeout>();

/**
 * Arms the idle disconnect after playback ends.
 *
 * The music bot holds a voice connection whether or not anything is coming out of it, so a
 * queue that ran dry an hour ago is just a bot squatting in a channel. The wait is per-guild
 * configurable because "long enough to queue the next song" is a matter of taste; 0 turns the
 * sweep off and the bot stays until something disconnects it.
 */
export function scheduleIdleLeave(player: KazagumoPlayer): void {
	const guildId = player.guildId;
	cancelIdleLeave(guildId);

	const idleTimeoutMs = getMusicConfig(guildId).idle_timeout_ms;
	if (idleTimeoutMs <= 0) return;

	const timer = setTimeout(() => {
		pending.delete(guildId);
		void leaveIfStillIdle(guildId);
	}, idleTimeoutMs);
	timer.unref();
	pending.set(guildId, timer);
}

/** Drops a pending disconnect — something started playing, or the player is already gone. */
export function cancelIdleLeave(guildId: string): void {
	const timer = pending.get(guildId);
	if (!timer) return;
	clearTimeout(timer);
	pending.delete(guildId);
}

async function leaveIfStillIdle(guildId: string): Promise<void> {
	const player = container.client.kazagumo.getPlayer(guildId);
	if (!player) return;

	// Re-checked rather than trusted: a track queued during the wait cancels the timer, but a
	// player resurrected by some path that doesn't emit playerStart would not.
	if (player.playing || player.paused || player.queue.current || player.queue.size > 0) return;

	container.logger.info(`[music/idle] ${guildId}: nothing played for a while, disconnecting`);
	await player.destroy().catch((error) => {
		container.logger.error(`[music/idle] ${guildId}: failed to disconnect: ${String(error)}`);
	});
}
