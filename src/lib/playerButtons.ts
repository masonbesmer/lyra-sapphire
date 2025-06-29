import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import type { GuildQueue } from 'discord-player';

export function buildPlayerRow(queue: GuildQueue<ChatInputCommandInteraction>) {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('player_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('player_pause')
			.setEmoji(queue.node.isPaused() ? '▶️' : '⏸️')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_repeat').setEmoji('🔂').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_seek_forward').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_seek_back').setEmoji('⏪').setStyle(ButtonStyle.Secondary)
	);
}
