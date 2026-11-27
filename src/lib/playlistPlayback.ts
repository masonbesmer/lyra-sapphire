import { container } from '@sapphire/framework';
import type { ChatInputCommandInteraction, GuildMember, User } from 'discord.js';
import { KazagumoTrack, type Kazagumo } from 'kazagumo';
import { getMusicConfig } from './config';
import { applyLoopMode, checkDJPermission } from './music';
import type { ActionResult } from './musicActions';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel, searchTracks } from './musicCommandHelpers';
import { DISCORD_CDN_HOSTS } from './attachmentAudio';
import { ingestFromDiscordCdn, mediaFileFromUri, mediaUrl, resolveMediaTrack, toMediaNewTrack, touchMedia } from './playlistMedia';
import { MAX_REPEAT, MAX_TRACKS_PER_PLAY, listTracks, updateTrackRaw, type NewTrack, type Playlist, type PlaylistTrack } from './playlists';
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
	const restored = new KazagumoTrack(JSON.parse(track.rawJson), requester).setKazagumo(kazagumo);
	// The raw JSON is what Lavalink sent; the stored title may have been corrected since (an upload's filename).
	restored.title = track.title;
	return restored;
}

function isDiscordUpload(uri: string | null | undefined): uri is string {
	if (!uri) return false;
	try {
		return DISCORD_CDN_HOSTS.has(new URL(uri).hostname);
	} catch {
		return false;
	}
}

export type SavableTrack = { ok: true; track: NewTrack } | { ok: false; reason: string };

/**
 * What saving a queued track into a playlist stores. A Discord upload is copied to disk first,
 * since its link expires; a track already playing from a stored copy (it came out of a playlist)
 * points at the same copy again. Anything else is stored as Lavalink sent it.
 */
export async function toSavableTrack(track: KazagumoTrack, userId: string, guildId: string): Promise<SavableTrack> {
	const stored = mediaFileFromUri(track.uri);
	if (stored && touchMedia(stored)) return { ok: true, track: toMediaNewTrack(track, stored, track.title) };
	if (!isDiscordUpload(track.uri)) return { ok: true, track: toNewTrack(track) };

	const ingested = await ingestFromDiscordCdn(track.uri, { uploaderId: userId, guildId });
	if (!ingested.ok) return ingested;
	return trackForStoredFile(ingested.file, track.title);
}

/** Loads a freshly stored file through Lavalink and builds its playlist row. */
export async function trackForStoredFile(file: string, title: string): Promise<SavableTrack> {
	const resolved = await resolveMediaTrack(container.client.kazagumo, file, title, null);
	if (!resolved) return { ok: false, reason: "couldn't decode that file" };
	return { ok: true, track: toMediaNewTrack(resolved, file, title) };
}

/**
 * A stored file's raw track embeds the /media URL it was loaded from. If that address has changed
 * (LAVALINK_MEDIA_BASE_URL), the track is loaded again and the new raw track saved, so the old URL
 * isn't handed to Lavalink.
 */
async function refreshMovedMedia(tracks: PlaylistTrack[]): Promise<PlaylistTrack[]> {
	return Promise.all(
		tracks.map(async (track) => {
			if (!track.mediaFile) return track;
			const raw = JSON.parse(track.rawJson) as { info?: { uri?: string } };
			if (raw.info?.uri === mediaUrl(track.mediaFile)) return track;
			const resolved = await resolveMediaTrack(container.client.kazagumo, track.mediaFile, track.title, null);
			if (!resolved) return track;
			const rawJson = toMediaNewTrack(resolved, track.mediaFile, track.title).rawJson;
			updateTrackRaw(track.id, rawJson);
			return { ...track, rawJson };
		})
	);
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

	const listed = listTracks(playlist.id);
	if (!listed.length) return { ok: false, error: 'that playlist is empty.', code: 'bad_input' };
	if (listed.length * options.repeat > MAX_TRACKS_PER_PLAY) {
		return { ok: false, error: `that would queue more than ${MAX_TRACKS_PER_PLAY} tracks, lower the repeat.`, code: 'bad_input' };
	}

	try {
		const kazagumo = container.client.kazagumo;
		const stored = await refreshMovedMedia(listed);
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
