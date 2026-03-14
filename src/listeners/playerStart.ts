import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import type { GuildTextBasedChannel } from 'discord.js';
import { storePlayerMessage, getCachedMessage } from '../lib/playerMessages';
import { buildPlayerRows } from '../lib/playerButtons';
import { buildNowPlayingEmbed } from '../lib/music';
import { addPlayHistory } from '../lib/musicHistory';
import { PLAYER_META_KEY, type PlayerMeta } from '../lib/queueMetadata';

export class PlayerStartListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerStart'
		});
	}

	public async run(player: KazagumoPlayer, track: KazagumoTrack) {
		const meta = player.data.get(PLAYER_META_KEY) as PlayerMeta | undefined;
		if (!meta) return;

		const channel = (await container.client.channels.fetch(meta.channelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;

		const embed = buildNowPlayingEmbed(player);
		const rows = buildPlayerRows(player);

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
				guild_id: player.guildId,
				user_id: meta.requestedBy?.id ?? 'unknown',
				track_title: track.title,
				track_url: track.uri ?? null,
				track_duration_ms: track.length ?? 0,
				source: track.sourceName ?? null,
				played_at: new Date().toISOString()
			});
		} catch (err) {
			container.logger.error(`[playerStart] Failed to record play history: ${String(err)}`);
		}
	}
}
