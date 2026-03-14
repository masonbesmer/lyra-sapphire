import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer } from 'kazagumo';
import type { GuildTextBasedChannel } from 'discord.js';
import { deletePlayerMessage } from '../lib/playerMessages';
import { PLAYER_META_KEY, type PlayerMeta } from '../lib/queueMetadata';

export class PlayerEmptyListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerEmpty'
		});
	}

	public async run(player: KazagumoPlayer) {
		const meta = player.data.get(PLAYER_META_KEY) as PlayerMeta | undefined;
		if (!meta) return;
		const channel = (await container.client.channels.fetch(meta.channelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;
		await deletePlayerMessage(channel);
	}
}
