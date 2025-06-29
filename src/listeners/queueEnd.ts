import { container, Listener } from '@sapphire/framework';
import type { GuildQueue } from 'discord-player';
import type { ChatInputCommandInteraction, GuildTextBasedChannel } from 'discord.js';
import { deletePlayerMessage } from '../lib/playerMessages';

export class QueueEndListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'queueEnd'
		});
	}

	public async run(queue: GuildQueue<ChatInputCommandInteraction>) {
		const interaction = queue.metadata;
		const channel = interaction.channel as GuildTextBasedChannel | null;
		if (!channel) return;
		await deletePlayerMessage(channel);
	}
}
