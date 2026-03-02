import { container, Listener } from '@sapphire/framework';
import type { GuildQueue } from 'discord-player';
import { broadcastEvent, broadcastQueueUpdate } from '../lib/websocket';

export class WebSocketQueueEndListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'queueEnd'
		});
	}

	public run(queue: GuildQueue) {
		const guildId = queue.guild.id;
		broadcastEvent(guildId, 'disconnected');
		broadcastQueueUpdate(guildId);
	}
}
