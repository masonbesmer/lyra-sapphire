import { container, Listener } from '@sapphire/framework';
import type { GuildQueue, Track } from 'discord-player';
import { broadcastQueueUpdate, broadcastEvent } from '../lib/websocket';

export class WebSocketBroadcastListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'playerStart'
		});
	}

	public run(queue: GuildQueue, track: Track) {
		const guildId = queue.guild.id;
		broadcastEvent(guildId, 'trackStart', {
			track: {
				title: track.title,
				url: track.url,
				thumbnail: track.thumbnail,
				duration: track.duration,
				durationMS: track.durationMS,
				author: track.author
			}
		});
		broadcastQueueUpdate(guildId);
	}
}
