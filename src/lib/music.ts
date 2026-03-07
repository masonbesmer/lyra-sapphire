import type { GuildQueue } from 'discord-player';
import { EmbedBuilder, type GuildMember } from 'discord.js';
import { getMusicConfig } from './config';
import { QueueRepeatMode } from 'discord-player';

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

// ── Queue helpers ────────────────────────────────────────────────────────────

/** Get the queue or throw a user-friendly error string. */
export function getQueueOrFail(queue: GuildQueue | undefined | null): GuildQueue {
	if (!queue) throw new Error('There is no active queue in this server.');
	return queue;
}

/** Human-readable label for a repeat mode. */
export function repeatModeLabel(mode: QueueRepeatMode): string {
	switch (mode) {
		case QueueRepeatMode.OFF:
			return 'Off';
		case QueueRepeatMode.TRACK:
			return 'Track';
		case QueueRepeatMode.QUEUE:
			return 'Queue';
		case QueueRepeatMode.AUTOPLAY:
			return 'Autoplay';
		default:
			return 'Unknown';
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

export function buildNowPlayingEmbed(queue: GuildQueue): EmbedBuilder {
	const track = queue.currentTrack;
	if (!track) {
		return new EmbedBuilder().setDescription('Nothing is currently playing.');
	}

	const position = queue.node.streamTime;
	const duration = track.durationMS;
	const bar = buildProgressBar(position, duration, 14);
	const posStr = formatDuration(position);
	const durStr = track.duration;

	const activeFilters = queue.filters.ffmpeg.filters ?? [];
	const filterStr = activeFilters.length > 0 ? activeFilters.join(', ') : 'None';
	const loopStr = repeatModeLabel(queue.repeatMode);
	const requester = track.requestedBy;
	const nextTrack = queue.tracks.at(0);

	const embed = new EmbedBuilder()
		.setTitle('🎵 Now Playing')
		.setDescription(`**[${track.title}](${track.url})**\nby ${track.author}`)
		.setThumbnail(track.thumbnail)
		.addFields(
			{ name: 'Progress', value: `${bar}\n${posStr} / ${durStr}`, inline: false },
			{ name: 'Volume', value: `${queue.node.volume}%`, inline: true },
			{ name: 'Loop', value: loopStr, inline: true },
			{ name: 'Filters', value: filterStr, inline: true },
			{ name: 'Requested by', value: requester ? `<@${requester.id}>` : 'Unknown', inline: true },
			{ name: 'Queue', value: `${queue.tracks.size} track(s)`, inline: true }
		)
		.setFooter({ text: nextTrack ? `Up next: ${nextTrack.title}` : 'Last track in queue' })
		.setColor(0x5865f2);

	return embed;
}

// ── Serialization (for WebUI) ─────────────────────────────────────────────────

export function serializeTrack(track: any) {
	return {
		title: track.title,
		url: track.url,
		thumbnail: track.thumbnail,
		duration: track.duration,
		durationMS: track.durationMS,
		author: track.author,
		requestedBy: track.requestedBy ? { id: track.requestedBy.id, username: track.requestedBy.username } : null
	};
}

export function serializeQueue(queue: GuildQueue | null) {
	if (!queue) return null;
	return {
		current: queue.currentTrack ? serializeTrack(queue.currentTrack) : null,
		tracks: queue.tracks.toArray().map(serializeTrack),
		volume: queue.node.volume,
		paused: queue.node.isPaused(),
		repeatMode: queue.repeatMode,
		filters: queue.filters.ffmpeg.filters ?? [],
		streamTime: queue.node.streamTime
	};
}
