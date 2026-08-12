import type { WsServerMessage } from './types';

export type WsMessageHandler = (msg: WsServerMessage) => void;

/**
 * Opens a subscription to a guild's player state and auto-reconnects on close.
 * Returns a cleanup function - call it (e.g. from onDestroy) to stop reconnecting and close the socket.
 */
export function connectGuildSocket(guildId: string, onMessage: WsMessageHandler): () => void {
	let ws: WebSocket | null = null;
	let closedByUser = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	function connect() {
		const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
		ws = new WebSocket(`${protocol}://${location.host}/ws`);
		ws.onopen = () => ws?.send(JSON.stringify({ type: 'subscribe', guildId }));
		ws.onmessage = (e) => {
			try {
				onMessage(JSON.parse(e.data) as WsServerMessage);
			} catch {
				// ignore malformed frames
			}
		};
		ws.onclose = () => {
			if (!closedByUser) reconnectTimer = setTimeout(connect, 3000);
		};
	}

	connect();

	return () => {
		closedByUser = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		ws?.close();
	};
}
