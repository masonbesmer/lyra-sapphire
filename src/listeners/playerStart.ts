import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import type { GuildTextBasedChannel } from 'discord.js';
import { storePlayerMessage, getCachedMessage } from '../lib/playerMessages';
import { buildPlayerPayload } from '../lib/playerComponents';
import { addPlayHistory } from '../lib/musicHistory';
import { PLAYER_META_KEY, type PlayerMeta } from '../lib/queueMetadata';
import { getMusicConfig } from '../lib/config';
import { cancelIdleLeave } from '../lib/musicIdle';

export class PlayerStartListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerStart'
		});
	}

	public async run(player: KazagumoPlayer, track: KazagumoTrack) {
		// Above the meta early-return: an idle timer left armed here would disconnect a bot
		// that is audibly playing.
		cancelIdleLeave(player.guildId);

		const meta = player.data.get(PLAYER_META_KEY) as PlayerMeta | undefined;
		if (!meta) return;

		const musicConfig = getMusicConfig(player.guildId);
		const targetChannelId = musicConfig.announce_channel_id ?? meta.channelId;
		const channel = (await container.client.channels.fetch(targetChannelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;

		const payload = buildPlayerPayload(player, { announce: musicConfig.announce_tracks });

		// Record play history - must run on every playerStart regardless of how the
		// message below is rendered, so it sits above the edit-in-place early return.
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

		const previousMessage = getCachedMessage(channel.id);

		if (previousMessage) {
			let edited = false;
			try {
				const [latest] = Array.from((await channel.messages.fetch({ limit: 1 })).values());
				if (latest && latest.id === previousMessage.id) {
					// An edit can still fail here - most likely a message sent before this bot
					// spoke Components V2, whose flags the API won't let us change - so fall
					// through to a fresh send rather than leaving a stale card behind.
					await previousMessage.edit(payload);
					await storePlayerMessage(channel, previousMessage);
					edited = true;
				}
			} catch {
				// ignore fetch or edit errors
			}
			if (edited) return;
			await previousMessage.delete().catch(() => {});
		}

		const message = await channel.send(payload);
		await storePlayerMessage(channel, message);
	}
}
