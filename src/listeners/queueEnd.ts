import { container, Listener } from '@sapphire/framework';
import type { GuildQueue } from 'discord-player';
import type { GuildTextBasedChannel } from 'discord.js';
import { deletePlayerMessage } from '../lib/playerMessages';
import type { QueueMetadata } from '../lib/queueMetadata';

export class QueueEndListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'queueEnd'
		});
	}

	public async run(queue: GuildQueue<QueueMetadata>) {
		const meta = queue.metadata;
		if (!meta) return;
		const channel = (await container.client.channels.fetch(meta.channelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;
		await deletePlayerMessage(channel);
	}
}
