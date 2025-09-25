import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener, container } from '@sapphire/framework';
import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: Events.MessageReactionAdd
})
export class LogMessageReactionAddListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		container.logger.debug(
			`Reaction added: user=${user.id} (${user.tag ?? 'unknown'}) | message=${reaction.message.id} | emoji=${reaction.emoji.name}`
		);
	}
}

@ApplyOptions<Listener.Options>({
	event: Events.MessageReactionRemove
})
export class LogMessageReactionRemoveListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		container.logger.debug(
			`Reaction removed: user=${user.id} (${user.tag ?? 'unknown'}) | message=${reaction.message.id} | emoji=${reaction.emoji.name}`
		);
	}
}
