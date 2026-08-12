import { container } from '@sapphire/framework';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { serializePlayer } from './music';
import { recordSession, removeSession, cleanupExpiredSessions } from './wsSessions';

type AuthedRequest = IncomingMessage & { authUserId?: string; authExpires?: number };

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
		const player = container.client.kazagumo.getPlayer(guildId);
		if (!player?.queue.current) return;
		broadcast(guildId, {
			type: 'trackProgress',
			position: player.position,
			duration: player.queue.current.length ?? 0
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

	httpServer.on('upgrade', (request: AuthedRequest, socket: any, head: Buffer) => {
		const url = request.url ?? '';
		if (!url.startsWith('/ws')) {
			socket.destroy();
			return;
		}

		// Decrypt the session cookie the same way the HTTP auth middleware does -
		// reject the upgrade outright if it doesn't resolve to a real session.
		const auth = container.server.auth;
		if (!auth) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		const cookieHeader = request.headers.cookie ?? '';
		const cookieMatch = new RegExp(`(?:^|;\\s*)${auth.cookie}=([^;]+)`).exec(cookieHeader);
		if (!cookieMatch) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		const session = auth.decrypt(decodeURIComponent(cookieMatch[1]));
		if (!session) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		request.authUserId = session.id;
		request.authExpires = session.expires;

		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request);
		});
	});

	wss.on('connection', (ws: WebSocket, request: AuthedRequest) => {
		const userId = request.authUserId!;
		const sessionExpires = request.authExpires!;
		const sessionId = randomUUID();
		let subscribedGuildId: string | null = null;

		ws.on('message', (raw) => {
			void (async () => {
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

						// The upgrade handler only proved the cookie is valid; re-verify the
						// user is actually a member of the guild they're asking to subscribe to.
						const member = await guild.members.fetch(userId).catch(() => null);
						if (!member) {
							ws.send(JSON.stringify({ type: 'error', message: 'Not a member of this guild' }));
							return;
						}

						if (!subscriptions.has(guildId)) subscriptions.set(guildId, new Set());
						subscriptions.get(guildId)!.add(ws);
						subscribedGuildId = guildId;

						cleanupExpiredSessions();
						recordSession(sessionId, userId, guildId, new Date(sessionExpires));

						ensureProgressInterval(guildId);

						// Send current state immediately
						const player = container.client.kazagumo.getPlayer(guildId) ?? null;
						ws.send(JSON.stringify({ type: 'queueUpdate', queue: serializePlayer(player) }));
					}
				} catch (err) {
					container.logger.debug(`[WS] malformed message: ${String(err)}`);
				}
			})();
		});

		ws.on('close', () => {
			if (subscribedGuildId) unsubscribe(subscribedGuildId, ws);
			removeSession(sessionId);
		});
	});

	return wss;
}

/** Broadcast a queue update to all subscribers for a guild. */
export function broadcastQueueUpdate(guildId: string) {
	const player = container.client.kazagumo.getPlayer(guildId) ?? null;
	broadcast(guildId, { type: 'queueUpdate', queue: serializePlayer(player) });
}

/** Broadcast a named event to all subscribers for a guild. */
export function broadcastEvent(guildId: string, type: string, data: object = {}) {
	broadcast(guildId, { type, ...data });
}
