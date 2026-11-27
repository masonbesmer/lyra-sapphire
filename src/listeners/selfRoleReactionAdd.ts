import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handlePanelReaction } from '../lib/selfRoleActions';

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionAdd })
export class SelfRoleReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		await handlePanelReaction(reaction, user, 'react').catch((error) =>
			this.container.logger.error(`[selfroles] reaction add failed: ${String(error)}`)
		);
	}
}
