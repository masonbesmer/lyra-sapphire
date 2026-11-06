import { container } from '@sapphire/framework';
import { playAlarm } from './playback';

/**
 * Voice timers and alarms.
 *
 * In memory only, and best-effort: a restart or redeploy drops every pending one. Persisting
 * them would mean a new table, which nobody has asked for yet.
 *
 * They outlive the assistant session on purpose. A timer set just before Lyra leaves voice
 * still posts its mention; only the tone, which needs her connection, is lost.
 */

export type TimerKind = 'timer' | 'alarm';

export interface TimerEntry {
	id: number;
	guildId: string;
	userId: string;
	textChannelId: string | null;
	kind: TimerKind;
	/** Epoch milliseconds. */
	fireAt: number;
	/** How it is named back: "timer for 5 minutes", "alarm for 7:30 AM". */
	label: string;
}

export const MAX_PENDING_PER_USER = 5;
const ALARM_ATTEMPTS = 3;
const ALARM_RETRY_MS = 1_500;

const pending = new Map<number, { entry: TimerEntry; handle: NodeJS.Timeout }>();
let nextId = 1;

export function list(guildId: string, userId: string): TimerEntry[] {
	return [...pending.values()]
		.map(({ entry }) => entry)
		.filter((entry) => entry.guildId === guildId && entry.userId === userId)
		.sort((a, b) => a.fireAt - b.fireAt);
}

/** Null when the speaker already has MAX_PENDING_PER_USER going in this guild. */
export function schedule(entry: Omit<TimerEntry, 'id'>): TimerEntry | null {
	if (list(entry.guildId, entry.userId).length >= MAX_PENDING_PER_USER) return null;
	const scheduled = { ...entry, id: nextId++ };
	const handle = setTimeout(
		() => {
			// Runs off a timer, so nothing upstream would catch a rejection.
			ring(scheduled.id).catch((error) =>
				container.logger.warn(`[voice/timers] ${scheduled.label} for ${scheduled.userId} failed to ring: ${String(error)}`)
			);
		},
		Math.max(0, entry.fireAt - Date.now())
	);
	pending.set(scheduled.id, { entry: scheduled, handle });
	return scheduled;
}

/** Cancels every pending one of `kind` (or of both kinds), returning how many went. */
export function cancel(guildId: string, userId: string, kind?: TimerKind): number {
	const doomed = list(guildId, userId).filter((entry) => !kind || entry.kind === kind);
	for (const { id } of doomed) {
		clearTimeout(pending.get(id)?.handle);
		pending.delete(id);
	}
	return doomed.length;
}

async function post(channelId: string | null, content: string): Promise<boolean> {
	if (!channelId) return false;
	const channel = container.client.channels.cache.get(channelId);
	if (!channel?.isTextBased() || !('send' in channel)) return false;
	return channel
		.send(content)
		.then(() => true)
		.catch(() => false);
}

/**
 * Always says so in text, whatever the guild's ack mode: a timer going off is what was asked
 * for, not an acknowledgement, and a silent timer is a broken one.
 */
async function ring(id: number): Promise<void> {
	const entry = pending.get(id)?.entry;
	if (!entry) return;
	pending.delete(id);

	const content = `⏰ <@${entry.userId}> your ${entry.label} is done.`;
	if (!(await post(entry.textChannelId, content))) {
		await container.client.users
			.send(entry.userId, content)
			.catch((error) => container.logger.warn(`[voice/timers] couldn't DM ${entry.userId}: ${String(error)}`));
	}

	// A spoken ack may be mid-sentence; give it a moment rather than dropping the tone.
	for (let attempt = 1; attempt <= ALARM_ATTEMPTS; attempt++) {
		if (await playAlarm(entry.guildId)) return;
		if (attempt < ALARM_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, ALARM_RETRY_MS));
	}
	container.logger.warn(`[voice/timers] couldn't play the alarm tone in ${entry.guildId}`);
}
