import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { KazagumoPlayer } from 'kazagumo';

function loopEmoji(loop: 'none' | 'queue' | 'track'): string {
	switch (loop) {
		case 'track':
			return '🔂';
		case 'queue':
			return '🔁';
		default:
			return '🔁';
	}
}

export function buildPlayerRow(player: KazagumoPlayer) {
	return buildPlayerRows(player)[0];
}

export function buildPlayerRows(player: KazagumoPlayer): ActionRowBuilder<ButtonBuilder>[] {
	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('player_previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('player_pause')
			.setEmoji(player.paused ? '▶️' : '⏸️')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('player_loop')
			.setEmoji(loopEmoji(player.loop))
			.setStyle(player.loop !== 'none' ? ButtonStyle.Primary : ButtonStyle.Secondary)
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
