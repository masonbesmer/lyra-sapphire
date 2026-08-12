import { container, Listener } from '@sapphire/framework';
import type { KazagumoPlayer } from 'kazagumo';
import type { GuildTextBasedChannel } from 'discord.js';
import { deletePlayerMessage } from '../lib/playerMessages';
import { PLAYER_META_KEY, type PlayerMeta } from '../lib/queueMetadata';
import { isAutoplayEnabled } from '../lib/music';

export class PlayerEmptyListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, {
			...options,
			emitter: container.client.kazagumo,
			event: 'playerEmpty'
		});
	}

	public async run(player: KazagumoPlayer) {
		if (isAutoplayEnabled(player) && (await this.tryAutoplay(player))) return;

		const meta = player.data.get(PLAYER_META_KEY) as PlayerMeta | undefined;
		if (!meta) return;
		const channel = (await container.client.channels.fetch(meta.channelId).catch(() => null)) as GuildTextBasedChannel | null;
		if (!channel) return;
		await deletePlayerMessage(channel);
	}

	/**
	 * Seeds a search from the last-played track's author (falling back to its
	 * title), filters out anything already in recent history, and enqueues +
	 * plays the first remaining result. Returns false if nothing suitable was
	 * found, so the caller falls through to normal empty-queue cleanup.
	 */
	private async tryAutoplay(player: KazagumoPlayer): Promise<boolean> {
		const seed = player.queue.previous[0];
		if (!seed) return false;

		try {
			const query = seed.author ?? seed.title;
			const result = await container.client.kazagumo.search(query, { requester: seed.requester });
			const recent = new Set([seed.uri, ...player.queue.previous.map((t) => t.uri)].filter((uri): uri is string => Boolean(uri)));
			const next = result.tracks.find((t) => !t.uri || !recent.has(t.uri));
			if (!next) return false;

			player.queue.add(next);
			await player.play();
			return true;
		} catch (err) {
			container.logger.error(`[autoplay] (${player.guildId}) ${String(err)}`);
			return false;
		}
	}
}
