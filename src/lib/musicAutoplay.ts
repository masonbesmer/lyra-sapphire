import { container } from '@sapphire/framework';
import type { KazagumoPlayer } from 'kazagumo';
import { searchTracks } from './musicCommandHelpers';

/**
 * Seeds a search from the last-played track's author (falling back to its
 * title), filters out anything already in recent history, and enqueues + plays
 * the first remaining result. Returns false if nothing suitable was found, so
 * callers can fall through to normal empty-queue handling.
 */
export async function tryAutoplay(player: KazagumoPlayer): Promise<boolean> {
	const seed = player.queue.previous[0];
	if (!seed) return false;

	try {
		const query = seed.author ?? seed.title;
		const result = await searchTracks(container.client.kazagumo, query, { requester: seed.requester });
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
