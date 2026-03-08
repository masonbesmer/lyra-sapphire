import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { EmbedBuilder, type GuildMember } from 'discord.js';
import { getMusicConfig } from './config';
import { getActiveFilters } from './lavalinkFilters';

// ── Formatting ──────────────────────────────────────────────────────────────

/** Format milliseconds as `m:ss` or `h:mm:ss`. */
export function formatDuration(ms: number): string {
	if (!ms || ms <= 0) return '0:00';
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/** Build a visual progress bar string (▬▬▬🔘▬▬▬▬▬▬). */
export function buildProgressBar(current: number, total: number, length = 12): string {
	if (!total || total <= 0) return '▬'.repeat(length);
	const ratio = Math.min(current / total, 1);
	const pos = Math.floor(ratio * length);
	const before = '▬'.repeat(pos);
	const after = '▬'.repeat(Math.max(0, length - pos - 1));
	return `${before}🔘${after}`;
}

/** Parse a time string in `1:30`, `90s`, or `90` format into milliseconds. */
export function parseTimeString(input: string): number | null {
	// mm:ss or hh:mm:ss
	if (/^\d+:\d{2}(:\d{2})?$/.test(input)) {
		const parts = input.split(':').map(Number);
		if (parts.length === 3) return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000;
		return (parts[0] * 60 + parts[1]) * 1000;
	}
	// e.g. "90s"
	const sMatch = input.match(/^(\d+)s$/i);
	if (sMatch) return parseInt(sMatch[1]) * 1000;
	// bare number (seconds)
	if (/^\d+$/.test(input)) return parseInt(input) * 1000;
	return null;
}

/** Strip common video suffixes from a track title for better lyrics search. */
export function cleanTrackTitle(title: string): string {
	return title
		.replace(/\(?(official\s*(music\s*)?video|official\s*audio|lyrics?|lyric\s*video|audio|hd|hq|4k|mv)\)?/gi, '')
		.replace(/\[.*?\]/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

// ── Player helpers ────────────────────────────────────────────────────────────

/** Get the player or throw a user-friendly error string. */
export function getPlayerOrFail(player: KazagumoPlayer | undefined | null): KazagumoPlayer {
	if (!player) throw new Error('There is no active player in this server.');
	return player;
}

/** Human-readable label for a Kazagumo loop mode. */
export function repeatModeLabel(loop: 'none' | 'queue' | 'track'): string {
	switch (loop) {
		case 'track':
			return 'Track';
		case 'queue':
			return 'Queue';
		default:
			return 'Off';
	}
}

// ── DJ permission ────────────────────────────────────────────────────────────

/**
 * Returns true if the member is allowed to perform DJ-restricted actions.
 * Bypass conditions:
 *  - No DJ role set for the guild
 *  - Member has ManageGuild
 *  - Member is alone in the voice channel with the bot
 */
export function checkDJPermission(member: GuildMember, guildId: string): boolean {
	const cfg = getMusicConfig(guildId);
	if (!cfg.dj_role_id) return true;
	if (member.permissions.has('ManageGuild')) return true;
	const djRole = member.guild.roles.cache.get(cfg.dj_role_id);
	if (!djRole) return true; // role was deleted — degrade gracefully
	if (member.roles.cache.has(cfg.dj_role_id)) return true;
	// Alone in voice with bot?
	const voiceChannel = member.voice.channel;
	if (voiceChannel) {
		const humanMembers = voiceChannel.members.filter((m) => !m.user.bot);
		if (humanMembers.size <= 1) return true;
	}
	return false;
}

// ── Embed builder ────────────────────────────────────────────────────────────

export function buildNowPlayingEmbed(player: KazagumoPlayer): EmbedBuilder {
	const track = player.queue.current;
	if (!track) {
		return new EmbedBuilder().setDescription('Nothing is currently playing.');
	}

	const position = player.position;
	const duration = track.length ?? 0;
	const bar = buildProgressBar(position, duration, 14);
	const posStr = formatDuration(position);
	const durStr = formatDuration(duration);

	const activeFilters = getActiveFilters(player);
	const filterStr = activeFilters.size > 0 ? [...activeFilters].join(', ') : 'None';
	const loopStr = repeatModeLabel(player.loop);
	const requester = track.requester as { id?: string; username?: string } | null | undefined;
	const nextTrack = player.queue[0] as KazagumoTrack | undefined;

	const embed = new EmbedBuilder()
		.setTitle('🎵 Now Playing')
		.setDescription(`**[${track.title}](${track.uri ?? track.title})**\nby ${track.author ?? 'Unknown'}`)
		.setThumbnail(track.thumbnail ?? null)
		.addFields(
			{ name: 'Progress', value: `${bar}\n${posStr} / ${durStr}`, inline: false },
			{ name: 'Volume', value: `${player.volume}%`, inline: true },
			{ name: 'Loop', value: loopStr, inline: true },
			{ name: 'Filters', value: filterStr, inline: true },
			{ name: 'Requested by', value: requester?.id ? `<@${requester.id}>` : 'Unknown', inline: true },
			{ name: 'Queue', value: `${player.queue.size} track(s)`, inline: true }
		)
		.setFooter({ text: nextTrack ? `Up next: ${nextTrack.title}` : 'Last track in queue' })
		.setColor(0x5865f2);

	return embed;
}

// ── Serialization (for WebUI) ─────────────────────────────────────────────────

export function serializeTrack(track: KazagumoTrack) {
	const requester = track.requester as { id?: string; username?: string } | null | undefined;
	return {
		title: track.title,
		url: track.uri ?? null,
		thumbnail: track.thumbnail ?? null,
		duration: formatDuration(track.length ?? 0),
		durationMS: track.length ?? 0,
		author: track.author ?? null,
		requestedBy: requester?.id ? { id: requester.id, username: requester.username ?? requester.id } : null
	};
}

export function serializePlayer(player: KazagumoPlayer | null) {
	if (!player) return null;
	const current = player.queue.current;
	return {
		current: current ? serializeTrack(current) : null,
		tracks: ([...player.queue] as KazagumoTrack[]).map(serializeTrack),
		volume: player.volume,
		paused: player.paused,
		loop: player.loop,
		filters: [...getActiveFilters(player)],
		position: player.position
	};
}

/** @deprecated Use serializePlayer */
export const serializeQueue = serializePlayer;
