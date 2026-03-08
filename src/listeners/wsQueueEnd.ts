import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer } from 'kazagumo';
import { broadcastEvent, broadcastQueueUpdate } from '../lib/websocket';

export class WebSocketQueueEndListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerEmpty'
		});
	}

	public run(player: KazagumoPlayer) {
		const guildId = player.guildId;
		broadcastEvent(guildId, 'disconnected');
		broadcastQueueUpdate(guildId);
	}
}
