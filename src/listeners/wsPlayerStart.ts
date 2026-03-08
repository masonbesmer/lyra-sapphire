import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { broadcastQueueUpdate, broadcastEvent } from '../lib/websocket';

export class WebSocketBroadcastListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerStart'
		});
	}

	public run(player: KazagumoPlayer, track: KazagumoTrack) {
		const guildId = player.guildId;
		broadcastEvent(guildId, 'trackStart', {
			track: {
				title: track.title,
				url: track.uri ?? null,
				thumbnail: track.thumbnail ?? null,
				durationMS: track.length ?? 0,
				author: track.author ?? null
			}
		});
		broadcastQueueUpdate(guildId);
	}
}
