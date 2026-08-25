import { container } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel, searchTracks } from './musicCommandHelpers';
import { broadcastEvent, broadcastQueueUpdate } from './websocket';
import { getMusicConfig } from './config';

export type ActionErrorCode = 'no_player' | 'bad_input' | 'no_results' | 'internal';
export type ActionResult<T = undefined> = { ok: true; message: string; data: T } | { ok: false; error: string; code: ActionErrorCode };

const NO_PLAYER: ActionResult<never> = { ok: false, error: 'Nothing is playing right now.', code: 'no_player' };

const VALID_LOOP_MODES = ['none', 'queue', 'track'] as const;

function getPlayer(guildId: string) {
	return container.client.kazagumo.getPlayer(guildId) ?? null;
}

export async function play(
	guildId: string,
	member: GuildMember,
	query: string,
	voiceChannelId: string
): Promise<ActionResult<{ title: string; url: string | null }>> {
	if (!query || !voiceChannelId) return { ok: false, error: 'Missing a track or a voice channel.', code: 'bad_input' };

	try {
		const kazagumo = container.client.kazagumo;
		const result = await searchTracks(kazagumo, query, { requester: member.user });
		if (!result.tracks.length) return { ok: false, error: 'No results found', code: 'no_results' };

		const player = await getOrCreatePlayer(kazagumo, {
			guildId,
			voiceId: voiceChannelId,
			textId: voiceChannelId,
			volume: getMusicConfig(guildId).default_volume
		});
		initPlayerMeta(player, { interaction: null, channelId: voiceChannelId, requestedBy: member.user });

		const tracksToAdd = result.type === 'PLAYLIST' ? result.tracks : [result.tracks[0]];
		// KazagumoQueue#add shifts the first entry off the array it is handed when nothing is
		// currently playing, so snapshot the track we report before queueing it.
		const [queuedTrack] = tracksToAdd;
		const message = await queueAndLabel(player, result);

		return { ok: true, message, data: { title: queuedTrack.title, url: queuedTrack.uri ?? null } };
	} catch (e) {
		container.logger.error(`[musicActions] play: ${String(e)}`);
		return { ok: false, error: 'The bot failed to queue that track - check its logs.', code: 'internal' };
	}
}

export async function skip(guildId: string, count?: number): Promise<ActionResult> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;

	if (count !== undefined) {
		if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'count must be a positive integer.', code: 'bad_input' };
		if (count > 1) player.queue.splice(0, Math.min(count - 1, player.queue.size));
	}

	player.skip();
	return { ok: true, message: 'Skipped.', data: undefined };
}

export async function pause(guildId: string, paused: boolean): Promise<ActionResult<{ paused: boolean }>> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;

	player.pause(paused);
	broadcastEvent(guildId, 'pauseStateChange', { paused: player.paused });
	broadcastQueueUpdate(guildId);
	return { ok: true, message: player.paused ? 'Paused.' : 'Resumed.', data: { paused: player.paused } };
}

export async function stop(guildId: string): Promise<ActionResult> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;

	try {
		await player.destroy();
		return { ok: true, message: 'Stopped.', data: undefined };
	} catch (e) {
		container.logger.error(`[musicActions] stop: ${String(e)}`);
		return { ok: false, error: 'Failed to stop playback - check the logs.', code: 'internal' };
	}
}

export async function setVolume(guildId: string, volume: number): Promise<ActionResult<{ volume: number }>> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;
	if (!volume || volume < 1 || volume > 100) return { ok: false, error: 'volume must be between 1 and 100.', code: 'bad_input' };

	try {
		await player.setVolume(volume);
		broadcastEvent(guildId, 'volumeChange', { volume });
		broadcastQueueUpdate(guildId);
		return { ok: true, message: `Volume set to ${volume}.`, data: { volume } };
	} catch (e) {
		container.logger.error(`[musicActions] setVolume: ${String(e)}`);
		return { ok: false, error: 'Failed to set the volume - check the logs.', code: 'internal' };
	}
}

export async function shuffle(guildId: string): Promise<ActionResult> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;

	player.queue.shuffle();
	return { ok: true, message: 'Shuffled the queue.', data: undefined };
}

export async function setLoop(guildId: string, mode: 'none' | 'queue' | 'track'): Promise<ActionResult<{ mode: string }>> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;
	if (!VALID_LOOP_MODES.includes(mode)) return { ok: false, error: 'mode must be one of none, queue, track.', code: 'bad_input' };

	player.setLoop(mode);
	broadcastEvent(guildId, 'loopChange', { mode });
	broadcastQueueUpdate(guildId);
	return { ok: true, message: `Loop mode set to ${mode}.`, data: { mode } };
}

export function nowPlaying(guildId: string): ActionResult<{ title: string; url: string | null } | null> {
	const player = getPlayer(guildId);
	const current = player?.queue.current;
	if (!player || !current) return NO_PLAYER;

	return { ok: true, message: `Now playing ${current.title}.`, data: { title: current.title, url: current.uri ?? null } };
}

export function queueSummary(guildId: string, limit = 5): ActionResult<{ titles: string[]; total: number }> {
	const player = getPlayer(guildId);
	if (!player) return NO_PLAYER;

	const tracks = [...player.queue];
	const titles = tracks.slice(0, limit).map((t) => t.title);
	return { ok: true, message: `${tracks.length} track(s) in the queue.`, data: { titles, total: tracks.length } };
}
