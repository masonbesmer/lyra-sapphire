import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer } from 'kazagumo';
import type { GuildTextBasedChannel } from 'discord.js';
import { deletePlayerMessage, getCachedMessage } from '../lib/playerMessages';
import { PLAYER_META_KEY, type PlayerMeta } from '../lib/queueMetadata';
import { isAutoplayEnabled } from '../lib/music';
import { tryAutoplay } from '../lib/musicAutoplay';
import { buildIdlePayload } from '../lib/playerComponents';
import { getMusicConfig } from '../lib/config';
import { scheduleIdleLeave } from '../lib/musicIdle';

export class PlayerEmptyListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerEmpty'
		});
	}

	public async run(player: KazagumoPlayer) {
		if (isAutoplayEnabled(player) && (await tryAutoplay(player))) return;

		// Playback has genuinely ended: autoplay either isn't on or found nothing to follow with.
		scheduleIdleLeave(player);

		const meta = player.data.get(PLAYER_META_KEY) as PlayerMeta | undefined;
		if (!meta) return;
		const musicConfig = getMusicConfig(player.guildId);
		const targetChannelId = musicConfig.announce_channel_id ?? meta.channelId;
		const channel = (await container.client.channels.fetch(targetChannelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;

		// The card stays put and offers the ways back into playback; playerDestroy is what
		// finally removes it, whether that's the idle timer or someone hitting disconnect.
		const cached = musicConfig.announce_tracks ? getCachedMessage(channel.id) : undefined;
		if (cached) {
			const edited = await cached.edit(buildIdlePayload()).then(
				() => true,
				() => false
			);
			if (edited) return;
		}

		await deletePlayerMessage(channel);
	}
}
