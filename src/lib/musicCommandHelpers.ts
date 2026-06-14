import type { Kazagumo, KazagumoPlayer, KazagumoSearchResult } from 'kazagumo';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } from 'discord-voip';
import type { VoiceConnection } from 'discord-voip';
import { PLAYER_META_KEY, type PlayerMeta } from './queueMetadata';
import { getActiveFilters, DATA_ACTIVE_FILTERS } from './lavalinkFilters';

export async function getOrCreatePlayer(
	kazagumo: Kazagumo,
	opts: { guildId: string; voiceId: string; textId: string; volume: number }
): Promise<KazagumoPlayer> {
	let player = kazagumo.getPlayer(opts.guildId);
	if (!player) {
		player = await kazagumo.createPlayer({
			guildId: opts.guildId,
			voiceId: opts.voiceId,
			textId: opts.textId,
			deaf: true,
			volume: opts.volume
		});
	}
	return player;
}

export function initPlayerMeta(player: KazagumoPlayer, meta: PlayerMeta): void {
	player.data.set(PLAYER_META_KEY, meta);
	if (!player.data.has(DATA_ACTIVE_FILTERS)) player.data.set(DATA_ACTIVE_FILTERS, getActiveFilters(player));
}

export async function queueAndLabel(player: KazagumoPlayer, result: KazagumoSearchResult): Promise<string> {
	const firstTrack = result.tracks[0];
	if (!firstTrack) return '❌ No playable track found for that query.';

	const tracksToAdd = result.type === 'PLAYLIST' ? result.tracks : [firstTrack];
	player.queue.add(tracksToAdd);

	if (!player.playing && !player.paused) await player.play();

	const label =
		result.type === 'PLAYLIST' ? `playlist **${result.playlistName ?? 'Unknown'}** (${tracksToAdd.length} tracks)` : `**${firstTrack.title}**`;

	return `queued ${label} ✅`;
}

export async function getOrCreateVoiceConnection(guild: Guild, channel: VoiceBasedChannel): Promise<VoiceConnection> {
	let connection = getVoiceConnection(guild.id);
	if (!connection) {
		connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: guild.id,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: false,
			selfMute: true
		});
		await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
	}
	return connection;
}
