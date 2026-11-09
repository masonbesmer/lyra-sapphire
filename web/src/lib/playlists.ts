import type { guildApi } from './api';
import type { PlaylistLists, PlaylistSummary } from './types';
import { pushInfo } from './toast';

type Api = ReturnType<typeof guildApi>;

export function formatLength(ms: number): string {
	const totalSeconds = Math.round(ms / 1000);
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = String(totalSeconds % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Playlists the viewer may add tracks to - the only ones "add now playing" can target. */
export function writablePlaylists(lists: PlaylistLists): PlaylistSummary[] {
	return [...lists.owned, ...lists.shared].filter((playlist) => playlist.access.create);
}

export async function addNowPlaying(api: Api, playlist: Pick<PlaylistSummary, 'id' | 'name'>): Promise<boolean> {
	const res = await api.post<{ ok: true; added: number }>(`playlists/${playlist.id}/tracks`, { nowPlaying: true });
	if (res) pushInfo(`Added the current track to ${playlist.name}`);
	return res !== null;
}
