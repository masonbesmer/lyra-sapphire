// import { ApplyOptions } from '@sapphire/decorators';
// import { Listener } from '@sapphire/framework';
// import { GuildNodeInit, GuildQueue, Track } from 'discord-player';
// import { GuildChannel, TextBasedChannel } from 'discord.js';
// import { Metadata, MetadataField } from 'mediaplex';

// @ApplyOptions<Listener.Options>({
// 	event: 'playerStart'
// })
// export class UserEvent extends Listener {
// 	public override run(queue: Metadata, track: Track) {
// 		queue.
// 	}
// }

import { container, Listener } from '@sapphire/framework';
import type { GuildQueue, Track } from 'discord-player';
import type { GuildTextBasedChannel } from 'discord.js';
import { storePlayerMessage, getCachedMessage } from '../lib/playerMessages';
import { buildPlayerRows } from '../lib/playerButtons';
import { buildNowPlayingEmbed } from '../lib/music';
import { addPlayHistory } from '../lib/musicHistory';
import type { QueueMetadata } from '../lib/queueMetadata';

export class PlayerEvent extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'playerStart'
		});
	}

	public async run(queue: GuildQueue<QueueMetadata>, track: Track) {
		const meta = queue.metadata;
		if (!meta) return;

		const channelId = meta.channelId;
		const channel = (await container.client.channels.fetch(channelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;

		const embed = buildNowPlayingEmbed(queue);
		const rows = buildPlayerRows(queue);

		const mentionId = meta.requestedBy?.id;
		const content = mentionId ? `<@${mentionId}>` : '';

		const previousMessage = getCachedMessage(channel.id);

		if (previousMessage) {
			try {
				const [latest] = Array.from((await channel.messages.fetch({ limit: 1 })).values());
				if (latest && latest.id === previousMessage.id) {
					await previousMessage.edit({ content, embeds: [embed], components: rows });
					await storePlayerMessage(channel, previousMessage);
					return;
				}
				await previousMessage.delete().catch(() => {});
			} catch {
				// ignore errors fetching or deleting
			}
		}

		const message = await channel.send({ content, embeds: [embed], components: rows });
		await storePlayerMessage(channel, message);

		// Record play history
		try {
			addPlayHistory({
				guild_id: queue.guild.id,
				user_id: meta.requestedBy?.id ?? 'unknown',
				track_title: track.title,
				track_url: track.url,
				track_duration_ms: track.durationMS,
				source: track.source ?? null,
				played_at: new Date().toISOString()
			});
		} catch (err) {
			container.logger.error(`[playerStart] Failed to record play history: ${String(err)}`);
		}
	}
}
