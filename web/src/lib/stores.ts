import { writable } from 'svelte/store';
import type { SerializedPlayer, VoiceState, WsServerMessage } from './types';
import { guildApi } from './api';
import { connectGuildSocket } from './ws';

/** The active guild's live player/queue state - kept in sync over WebSocket. */
export const queue = writable<SerializedPlayer | null>(null);

/**
 * The viewer's own voice channel in the active guild. Null while unknown or while they're
 * not connected - the dashboard hides the player entirely in that case, since every playback
 * action the server accepts requires them to be in the channel they're acting on.
 */
export const voiceState = writable<VoiceState | null>(null);

let disconnect: (() => void) | null = null;
let currentGuildId: string | null = null;

function handleMessage(msg: WsServerMessage) {
	switch (msg.type) {
		case 'queueUpdate':
			queue.set(msg.queue);
			return;
		case 'trackProgress':
			queue.update((q) => (q ? { ...q, position: msg.position } : q));
			return;
		case 'pauseStateChange':
			queue.update((q) => (q ? { ...q, paused: msg.paused } : q));
			return;
		case 'volumeChange':
			queue.update((q) => (q ? { ...q, volume: msg.volume } : q));
			return;
		case 'loopChange':
			queue.update((q) => (q ? { ...q, loop: msg.mode } : q));
			return;
		case 'voiceState':
			voiceState.set({ channelId: msg.channelId, channelName: msg.channelName });
			return;
		case 'filterChange':
			if (msg.active) queue.update((q) => (q ? { ...q, filters: msg.active! } : q));
			return;
		case 'eqChange':
			queue.update((q) => (q ? { ...q, eq: msg.gains } : q));
			return;
		case 'trackStart':
		case 'disconnected':
		case 'error':
			// The server always follows these with a queueUpdate (wsPlayerStart.ts /
			// wsQueueEnd.ts), which is what actually updates displayed state.
			return;
	}
}

/** Subscribes to a guild's queue - fetches the current state once, then stays live over WS. */
export async function connectQueue(guildId: string): Promise<void> {
	if (currentGuildId === guildId && disconnect) return;
	disconnectQueue();
	currentGuildId = guildId;

	const api = guildApi(guildId);
	const [player, voice] = await Promise.all([api.get<SerializedPlayer>('queue'), api.get<VoiceState>('voice-state')]);
	queue.set(player);
	voiceState.set(voice);
	disconnect = connectGuildSocket(guildId, handleMessage);
}

export function disconnectQueue(): void {
	disconnect?.();
	disconnect = null;
	currentGuildId = null;
	queue.set(null);
	voiceState.set(null);
}
