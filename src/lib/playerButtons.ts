import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { GuildQueue } from 'discord-player';
import { QueueRepeatMode } from 'discord-player';

function loopEmoji(mode: QueueRepeatMode): string {
	switch (mode) {
		case QueueRepeatMode.TRACK:
			return '🔂';
		case QueueRepeatMode.QUEUE:
			return '🔁';
		case QueueRepeatMode.AUTOPLAY:
			return '🔄';
		default:
			return '🔁';
	}
}

export function buildPlayerRow(queue: GuildQueue) {
	return buildPlayerRows(queue)[0];
}

export function buildPlayerRows(queue: GuildQueue): ActionRowBuilder<ButtonBuilder>[] {
	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('player_previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('player_pause')
			.setEmoji(queue.node.isPaused() ? '▶️' : '⏸️')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('player_loop')
			.setEmoji(loopEmoji(queue.repeatMode))
			.setStyle(queue.repeatMode !== QueueRepeatMode.OFF ? ButtonStyle.Primary : ButtonStyle.Secondary)
	);

	const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('player_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_vol_down').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_vol_up').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_lyrics').setEmoji('📜').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_filters').setEmoji('🎛️').setStyle(ButtonStyle.Secondary)
	);

	return [row1, row2];
}
