import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handleReactionChange } from './starboardReactions';

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionAdd })
export class MessageReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		if (user.bot) return;
		await handleReactionChange.call(this, reaction);
	}
}
