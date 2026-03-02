import { container } from '@sapphire/framework';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { useMainPlayer } from 'discord-player';
import { serializeQueue } from './music';

/** Map from guildId → set of subscribed WebSocket clients */
const subscriptions = new Map<string, Set<WebSocket>>();
/** Map from guildId → progress interval */
const progressIntervals = new Map<string, NodeJS.Timeout>();

function broadcast(guildId: string, payload: object) {
	const subs = subscriptions.get(guildId);
	if (!subs) return;
	const json = JSON.stringify(payload);
	for (const ws of subs) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(json);
		}
	}
}

function ensureProgressInterval(guildId: string) {
	if (progressIntervals.has(guildId)) return;
	const interval = setInterval(() => {
		const player = useMainPlayer();
		const queue = player.nodes.get(guildId);
		if (!queue?.currentTrack) return;
		broadcast(guildId, {
			type: 'trackProgress',
			position: queue.node.streamTime,
			duration: queue.currentTrack.durationMS
		});
	}, 1000);
	progressIntervals.set(guildId, interval);
}

function removeProgressInterval(guildId: string) {
	const interval = progressIntervals.get(guildId);
	if (interval) {
		clearInterval(interval);
		progressIntervals.delete(guildId);
	}
}

function unsubscribe(guildId: string, ws: WebSocket) {
	const subs = subscriptions.get(guildId);
	if (subs) {
		subs.delete(ws);
		if (subs.size === 0) {
			subscriptions.delete(guildId);
			removeProgressInterval(guildId);
		}
	}
}

/**
 * Attach a WebSocket server to the existing HTTP server.
 * The client connects and sends:
 *   { type: 'subscribe', guildId: '...' }
 * The server then pushes real-time events for that guild.
 */
export function attachWebSocketServer(httpServer: HttpServer) {
	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
		const url = request.url ?? '';
		if (!url.startsWith('/ws')) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request);
		});
	});

	wss.on('connection', (ws: WebSocket) => {
		let subscribedGuildId: string | null = null;

		ws.on('message', (raw) => {
			try {
				const msg = JSON.parse(raw.toString());
				if (msg.type === 'subscribe' && typeof msg.guildId === 'string') {
					// Remove from previous subscription
					if (subscribedGuildId) unsubscribe(subscribedGuildId, ws);

					const guildId = msg.guildId;
					const guild = container.client.guilds.cache.get(guildId);
					if (!guild) {
						ws.send(JSON.stringify({ type: 'error', message: 'Guild not found' }));
						return;
					}

					if (!subscriptions.has(guildId)) subscriptions.set(guildId, new Set());
					subscriptions.get(guildId)!.add(ws);
					subscribedGuildId = guildId;

					ensureProgressInterval(guildId);

					// Send current state immediately
					const player = useMainPlayer();
					const queue = player.nodes.get(guildId) ?? null;
					ws.send(JSON.stringify({ type: 'queueUpdate', queue: serializeQueue(queue) }));
				}
			} catch {
				// ignore malformed messages
			}
		});

		ws.on('close', () => {
			if (subscribedGuildId) unsubscribe(subscribedGuildId, ws);
		});
	});

	return wss;
}

/** Broadcast a queue update to all subscribers for a guild. */
export function broadcastQueueUpdate(guildId: string) {
	const player = useMainPlayer();
	const queue = player.nodes.get(guildId) ?? null;
	broadcast(guildId, { type: 'queueUpdate', queue: serializeQueue(queue) });
}

/** Broadcast a named event to all subscribers for a guild. */
export function broadcastEvent(guildId: string, type: string, data: object = {}) {
	broadcast(guildId, { type, ...data });
}
