import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Interaction } from 'discord.js';
import { handlePanelInteraction } from '../lib/selfRoleActions';

/** Role-panel buttons and select menus (custom IDs starting `selfrole:`). */
@ApplyOptions<Listener.Options>({ event: Events.InteractionCreate })
export class SelfRoleInteractionListener extends Listener<typeof Events.InteractionCreate> {
	public async run(interaction: Interaction) {
		if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
		if (!interaction.customId.startsWith('selfrole:')) return;
		try {
			await handlePanelInteraction(interaction);
		} catch (error) {
			this.container.logger.error(`[selfroles] interaction failed: ${String(error)}`);
		}
	}
}
