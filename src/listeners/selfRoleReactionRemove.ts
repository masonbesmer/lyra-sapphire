import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handlePanelReaction } from '../lib/selfRoleActions';

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionRemove })
export class SelfRoleReactionRemoveListener extends Listener<typeof Events.MessageReactionRemove> {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		await handlePanelReaction(reaction, user, 'unreact').catch((error) =>
			this.container.logger.error(`[selfroles] reaction remove failed: ${String(error)}`)
		);
	}
}
