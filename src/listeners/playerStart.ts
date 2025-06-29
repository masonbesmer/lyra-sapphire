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
import { EmbedBuilder, type ChatInputCommandInteraction, type GuildTextBasedChannel } from 'discord.js';
import { storePlayerMessage, getCachedMessage } from '../lib/playerMessages';
import { buildPlayerRow } from '../lib/playerButtons';

export class PlayerEvent extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'playerStart'
		});
	}

	public async run(queue: GuildQueue<ChatInputCommandInteraction>, track: Track) {
		const interaction = queue.metadata;
		const channel = interaction.channel as GuildTextBasedChannel | null;
		if (!channel) return;

		const embed = new EmbedBuilder()
			.setDescription(`[${track.title}](${track.url})`)
			.setThumbnail(track.thumbnail)
			.addFields({ name: 'Queue Length', value: String(queue.tracks.size) });

		const row = buildPlayerRow(queue);

		const previousMessage = getCachedMessage(channel.id);

		if (previousMessage) {
			try {
				const [latest] = Array.from((await channel.messages.fetch({ limit: 1 })).values());
				if (latest && latest.id === previousMessage.id) {
					await previousMessage.edit({
						content: `<@${interaction.user.id}>`,
						embeds: [embed],
						components: [row]
					});
					await storePlayerMessage(channel, previousMessage);
					return;
				}
				await previousMessage.delete().catch(() => {});
			} catch {
				// ignore errors fetching or deleting
			}
		}

		const message = await channel.send({
			content: `<@${interaction.user.id}>`,
			embeds: [embed],
			components: [row]
		});
		await storePlayerMessage(channel, message);
	}
}
