import { container } from '@sapphire/framework';
import type { ChatInputCommandInteraction, GuildMember, User } from 'discord.js';
import { KazagumoTrack, type Kazagumo } from 'kazagumo';
import { getMusicConfig } from './config';
import { applyLoopMode, checkDJPermission } from './music';
import type { ActionResult } from './musicActions';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel, searchTracks } from './musicCommandHelpers';
import { MAX_REPEAT, MAX_TRACKS_PER_PLAY, listTracks, type NewTrack, type Playlist, type PlaylistTrack } from './playlists';
import { broadcastEvent, broadcastQueueUpdate } from './websocket';

/** Stores the Lavalink track Kazagumo was handed, so replaying it needs no second search. */
export function toNewTrack(track: KazagumoTrack): NewTrack {
	return {
		title: track.title,
		uri: track.uri ?? null,
		author: track.author ?? null,
		lengthMs: track.length ?? 0,
		source: track.sourceName ?? null,
		rawJson: JSON.stringify(track.getRaw()._raw)
	};
}

export function toKazagumoTrack(track: PlaylistTrack, requester: User, kazagumo: Kazagumo): KazagumoTrack {
	return new KazagumoTrack(JSON.parse(track.rawJson), requester).setKazagumo(kazagumo);
}

/** A playlist URL contributes every track it holds; a plain search contributes its top hit. */
export async function resolveTracksForQuery(query: string, requester: User): Promise<NewTrack[]> {
	const result = await searchTracks(container.client.kazagumo, query, { requester });
	const tracks = result.type === 'PLAYLIST' ? result.tracks : result.tracks.slice(0, 1);
	return tracks.map(toNewTrack);
}

export function currentTrack(guildId: string): KazagumoTrack | null {
	return container.client.kazagumo.getPlayer(guildId)?.queue.current ?? null;
}

function shuffled<T>(items: T[]): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export interface PlayPlaylistOptions {
	guildId: string;
	member: GuildMember;
	voiceChannelId: string;
	textChannelId: string;
	interaction: ChatInputCommandInteraction | null;
	playlist: Playlist;
	/** Shuffles the playlist's own tracks, each repeat separately; never what others queued. */
	shuffle: boolean;
	/** Endless queue loop, exactly as /loop queue — guild-wide player state, so DJ-gated. */
	loop: boolean;
	/** How many times the playlist is queued back to back. */
	repeat: number;
}

export async function playPlaylist(options: PlayPlaylistOptions): Promise<ActionResult<{ queued: number }>> {
	const { guildId, member, playlist } = options;

	if (options.loop && !checkDJPermission(member, guildId)) {
		return { ok: false, error: 'looping changes the whole queue, that needs the DJ role.', code: 'bad_input' };
	}
	if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > MAX_REPEAT) {
		return { ok: false, error: `repeat has to be between 1 and ${MAX_REPEAT}.`, code: 'bad_input' };
	}

	const stored = listTracks(playlist.id);
	if (!stored.length) return { ok: false, error: 'that playlist is empty.', code: 'bad_input' };
	if (stored.length * options.repeat > MAX_TRACKS_PER_PLAY) {
		return { ok: false, error: `that would queue more than ${MAX_TRACKS_PER_PLAY} tracks, lower the repeat.`, code: 'bad_input' };
	}

	try {
		const kazagumo = container.client.kazagumo;
		const tracks = Array.from({ length: options.repeat }, () => {
			const pass = stored.map((track) => toKazagumoTrack(track, member.user, kazagumo));
			return options.shuffle ? shuffled(pass) : pass;
		}).flat();
		const queued = tracks.length;

		const player = await getOrCreatePlayer(kazagumo, {
			guildId,
			voiceId: options.voiceChannelId,
			textId: options.textChannelId,
			volume: getMusicConfig(guildId).default_volume
		});
		initPlayerMeta(player, { interaction: options.interaction, channelId: options.textChannelId, requestedBy: member.user });
		const message = await queueAndLabel(player, { type: 'PLAYLIST', playlistName: playlist.name, tracks });

		if (options.loop) {
			applyLoopMode(player, 'queue');
			broadcastEvent(guildId, 'loopChange', { mode: 'queue' });
			broadcastQueueUpdate(guildId);
		}

		return { ok: true, message, data: { queued } };
	} catch (e) {
		container.logger.error(`[playlist] play: ${String(e)}`);
		return { ok: false, error: 'failed to queue that playlist, check the logs.', code: 'internal' };
	}
}
