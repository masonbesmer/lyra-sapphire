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
import {
       ActionRowBuilder,
       ButtonBuilder,
       ButtonStyle,
       EmbedBuilder,
       type ChatInputCommandInteraction,
       type GuildTextBasedChannel
} from 'discord.js';

export class PlayerEvent extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'playerStart'
		});
	}

        public run(queue: GuildQueue<ChatInputCommandInteraction>, track: Track) {
                const interaction = queue.metadata;
                const channel = interaction.channel as GuildTextBasedChannel | null;
                if (!channel) return;

                const embed = new EmbedBuilder()
                        .setDescription(`[${track.title}](${track.url})`)
                        .setThumbnail(track.thumbnail)
                        .addFields({ name: 'Queue Length', value: String(queue.tracks.size) });

                const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('player_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                                .setCustomId('player_pause')
                                .setLabel(queue.node.isPaused() ? 'Play' : 'Pause')
                                .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('player_repeat').setLabel('Repeat Song').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('player_seek_forward').setLabel('Seek +10s').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('player_seek_back').setLabel('Seek -10s').setStyle(ButtonStyle.Secondary)
                );

                return channel.send({
                        content: `<@${interaction.user.id}>`,
                        embeds: [embed],
                        components: [row]
                });
        }
}
