import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getModQueueConfig } from './modQueue';

/** Every button and modal the moderation suite owns starts with this, so one listener can route them. */
export const MOD_PREFIX = 'mod:';

/**
 * The appeal buttons for a ban DM, or none if the server hasn't set appeals up. Kept apart from
 * modQueueActions so modActions (which sends the DM) doesn't import it back in a cycle.
 */
export function appealComponents(guildId: string): ActionRowBuilder<ButtonBuilder>[] {
	const config = getModQueueConfig(guildId);
	const row = new ActionRowBuilder<ButtonBuilder>();
	if (config.appeal_channel_id) {
		row.addComponents(
			new ButtonBuilder().setCustomId(`${MOD_PREFIX}appeal:open:${guildId}`).setLabel('Appeal this ban').setStyle(ButtonStyle.Primary)
		);
	}
	if (config.appeal_url) row.addComponents(new ButtonBuilder().setURL(config.appeal_url).setLabel('Appeal form').setStyle(ButtonStyle.Link));
	return row.components.length ? [row] : [];
}
