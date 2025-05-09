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
import { GuildTextBasedChannel } from 'discord.js';

export class PlayerEvent extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.player.events,
			event: 'playerStart'
		});
	}

	public run(queue: GuildQueue<{ channel: GuildTextBasedChannel }>, track: Track) {
		return queue.metadata.channel.send(`💿 | now playing: **${track.title || 'Unknown Title'}**`);
	}
}