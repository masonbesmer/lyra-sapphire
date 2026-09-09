import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder
} from 'discord.js';
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { getActiveFilters } from './lavalinkFilters';
import { buildProgressBar, formatDuration, isAutoplayEnabled, loopDisplayMode, repeatModeLabel } from './music';

const ACCENT = 0x5865f2;

/**
 * Components V2 forbids `content` and `embeds` on the same message, so every
 * payload built here is components-only and the flag must travel with it — an
 * edit that drops the flag is rejected by the API.
 */
export const PLAYER_MESSAGE_FLAGS = MessageFlags.IsComponentsV2;

export type PlayerPayload = {
	components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
	flags: typeof PLAYER_MESSAGE_FLAGS;
};

// ── Rows ─────────────────────────────────────────────────────────────────────

function transportRow(player: KazagumoPlayer) {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('player_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('player_pause')
			.setEmoji(player.paused ? '▶️' : '⏸️')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_queue').setEmoji('📋').setStyle(ButtonStyle.Secondary)
	);
}

/**
 * The overflow menu. Values are the action suffix, not a full custom id: the
 * controls listener normalises `player_options` + value into `player_<value>`
 * so a dropdown entry and a button of the same name share one handler.
 */
function optionsRow(player: KazagumoPlayer) {
	const select = new StringSelectMenuBuilder()
		.setCustomId('player_options')
		.setPlaceholder('Player options')
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('Loop mode')
				.setValue('loop')
				.setEmoji('🔁')
				.setDescription(`Currently: ${repeatModeLabel(loopDisplayMode(player))}`),
			new StringSelectMenuOptionBuilder()
				.setLabel('Autoplay')
				.setValue('autoplay')
				.setEmoji('♾️')
				.setDescription(isAutoplayEnabled(player) ? 'Currently: on' : 'Currently: off'),
			new StringSelectMenuOptionBuilder().setLabel('Volume up').setValue('vol_up').setEmoji('🔊').setDescription(`${player.volume}% → +10%`),
			new StringSelectMenuOptionBuilder()
				.setLabel('Volume down')
				.setValue('vol_down')
				.setEmoji('🔉')
				.setDescription(`${player.volume}% → -10%`),
			new StringSelectMenuOptionBuilder().setLabel('Restart track').setValue('restart').setEmoji('↩️').setDescription('Seek back to 0:00')
		);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function utilityRow() {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('player_lyrics').setLabel('Lyrics').setEmoji('📜').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_filters').setLabel('Filters').setEmoji('🎛️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('player_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
	);
}

// ── Cards ────────────────────────────────────────────────────────────────────

function statusLine(player: KazagumoPlayer): string {
	const filters = getActiveFilters(player);
	const parts = [`🔊 ${player.volume}%`, `🔁 ${repeatModeLabel(loopDisplayMode(player))}`, `📋 ${player.queue.size} queued`];
	if (filters.size > 0) parts.push(`🎛️ ${[...filters].join(', ')}`);
	return `-# ${parts.join(' · ')}`;
}

function nowPlayingContainer(player: KazagumoPlayer, track: KazagumoTrack) {
	const requester = track.requester as { id?: string } | null | undefined;
	const index = String(player.queue.previous.length + 1).padStart(2, '0');
	const next = player.queue[0] as KazagumoTrack | undefined;

	const container = new ContainerBuilder().setAccentColor(ACCENT);

	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`\`${index}\` · ${requester?.id ? `<@${requester.id}>` : 'Unknown'}`));

	if (track.thumbnail) {
		container.addMediaGalleryComponents(
			new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(track.thumbnail).setDescription(track.title))
		);
	}

	const duration = track.length ?? 0;
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			[
				`## ${track.uri ? `[${track.title}](${track.uri})` : track.title}`,
				track.author ?? 'Unknown',
				`-# ${buildProgressBar(player.position, duration, 14)} ${formatDuration(player.position)} / ${formatDuration(duration)}`
			].join('\n')
		)
	);

	container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(next ? `${statusLine(player)}\n-# ⏭️ Up next: ${next.title}` : statusLine(player))
	);

	container.addActionRowComponents(transportRow(player));
	container.addActionRowComponents(optionsRow(player));
	container.addActionRowComponents(utilityRow());

	return container;
}

/**
 * The playing card. `announce` off keeps the controls but drops the artwork and
 * track details, matching the old behaviour of sending bare button rows.
 */
export function buildPlayerPayload(player: KazagumoPlayer, options: { announce?: boolean } = {}): PlayerPayload {
	const track = player.queue.current;
	const announce = options.announce ?? true;

	if (!announce || !track) {
		return { components: [transportRow(player), utilityRow()], flags: PLAYER_MESSAGE_FLAGS };
	}

	return { components: [nowPlayingContainer(player, track)], flags: PLAYER_MESSAGE_FLAGS };
}

/** The card the player message becomes once the queue runs dry. */
export function buildIdlePayload(): PlayerPayload {
	const container = new ContainerBuilder()
		.setAccentColor(ACCENT)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent('Use `/play` to add more songs to the queue'))
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId('player_autoplay_start').setLabel('Start Autoplay').setEmoji('♾️').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId('player_restart_queue').setLabel('Restart Queue').setEmoji('🔂').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId('player_stop').setLabel('Disconnect bot').setEmoji('📞').setStyle(ButtonStyle.Danger)
			)
		);

	return { components: [container], flags: PLAYER_MESSAGE_FLAGS };
}
