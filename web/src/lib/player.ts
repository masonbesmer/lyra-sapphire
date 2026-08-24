import type { guildApi } from './api';
import { pushInfo } from './toast';

/** The /play route echoes back what it actually queued, which may differ from what was asked for. */
interface PlayResponse {
	ok: boolean;
	track: { title: string };
}

/**
 * Queues a known track URL into the caller's voice channel. Shared by the search results and the
 * history tab's replay button, which both hand /play a URL rather than a search term.
 *
 * Callers must not offer the action for a track with no URL - see HistoryRow.track_url.
 */
export async function queueTrackUrl(api: ReturnType<typeof guildApi>, url: string, fallbackTitle: string, channelId: string): Promise<void> {
	const res = await api.post<PlayResponse>('play', { query: url, channelId });
	if (res) pushInfo(`Queued: ${res.track?.title ?? fallbackTitle}`);
}
