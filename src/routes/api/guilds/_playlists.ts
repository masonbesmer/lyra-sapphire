import type { ApiRequest, ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { HttpCodes } from '@sapphire/plugin-api';
import type { Guild, GuildMember } from 'discord.js';
import {
	authorizePlaylist,
	listGrants,
	listTracks,
	MAX_NAME_LENGTH,
	MAX_PLAYLISTS_PER_OWNER,
	type NameError,
	type Playlist,
	type PlaylistAccess,
	type PlaylistGrant,
	type PlaylistRight
} from '../../../lib/playlists';
import { resolveGuild } from './_helpers';

export interface LoadedPlaylist {
	guild: Guild;
	member: GuildMember;
	playlist: Playlist;
	access: PlaylistAccess;
}

/**
 * Every per-playlist route starts here: session, guild membership, then the shared
 * authorizePlaylist gate with the right the route needs. Sends the error response itself.
 */
export async function loadPlaylist(request: ApiRequest, response: ApiResponse, need: PlaylistRight): Promise<LoadedPlaylist | null> {
	const resolved = await resolveGuild(request, response, request.params.guild);
	if (!resolved) return null;

	const id = parsePositiveInt(request.params.playlist);
	if (id === null) {
		response.error(HttpCodes.BadRequest, 'That is not a playlist id.');
		return null;
	}

	const result = await authorizePlaylist(resolved.guild, request.auth!.id, id, need);
	if (!result.ok) {
		if (result.reason === 'not_found') response.error(HttpCodes.NotFound, "That playlist doesn't exist or you can't see it.");
		else response.error(HttpCodes.Forbidden, "You don't have permission to do that to this playlist.");
		return null;
	}

	return { ...resolved, playlist: result.playlist, access: result.access };
}

export function parsePositiveInt(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function usernameOf(userId: string): Promise<string> {
	const user = container.client.users.cache.get(userId) ?? (await container.client.users.fetch(userId).catch(() => null));
	return user?.username ?? userId;
}

export interface PlaylistSummary {
	id: number;
	name: string;
	description: string | null;
	isPublic: boolean;
	owner: { id: string; username: string };
	trackCount: number;
	totalLengthMs: number;
	coverUrl: string | null;
	access: PlaylistAccess;
}

export async function serializeSummary(playlist: Playlist, access: PlaylistAccess, guildId: string): Promise<PlaylistSummary> {
	return {
		id: playlist.id,
		name: playlist.name,
		description: playlist.description,
		isPublic: playlist.isPublic,
		owner: { id: playlist.ownerId, username: await usernameOf(playlist.ownerId) },
		trackCount: playlist.trackCount,
		totalLengthMs: playlist.totalLengthMs,
		// The version busts the browser cache, which otherwise keeps the old cover for a day.
		coverUrl: playlist.coverUpdatedAt
			? `/api/guilds/${guildId}/playlists/${playlist.id}/cover?v=${encodeURIComponent(playlist.coverUpdatedAt)}`
			: null,
		access
	};
}

export async function serializeDetail(loaded: LoadedPlaylist) {
	const { playlist, access, guild } = loaded;
	const tracks = await Promise.all(
		listTracks(playlist.id).map(async (track) => ({
			id: track.id,
			position: track.position + 1,
			title: track.title,
			uri: track.uri,
			author: track.author,
			lengthMs: track.lengthMs,
			addedBy: await usernameOf(track.addedBy)
		}))
	);
	return {
		...(await serializeSummary(playlist, access, guild.id)),
		tracks,
		// Who else can touch a playlist is the owner's business only.
		grants: access.manage ? await Promise.all(listGrants(playlist.id).map(serializeGrant)) : []
	};
}

export async function serializeGrant(grant: PlaylistGrant) {
	return { ...grant, username: await usernameOf(grant.userId) };
}

export function sendPlaylistError(response: ApiResponse, error: NameError | 'limit'): void {
	switch (error) {
		case 'invalid_name':
			return response.error(HttpCodes.BadRequest, `A playlist name needs 1 to ${MAX_NAME_LENGTH} characters on one line.`);
		case 'duplicate':
			return response.error(HttpCodes.Conflict, 'The owner already has a playlist with that name.');
		case 'limit':
			return response.error(HttpCodes.BadRequest, `You already have ${MAX_PLAYLISTS_PER_OWNER} playlists - delete one first.`);
	}
}
