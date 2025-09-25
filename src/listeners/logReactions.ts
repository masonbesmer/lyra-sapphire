import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: 'messageReactionAdd'
})
export class LogMessageReactionAddListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		this.container.client.logger.info(
			`Reaction added: user=${user.id} (${user.tag ?? 'unknown'}) | message=${reaction.message.id} | emoji=${reaction.emoji.name}`
		);
	}
}

@ApplyOptions<Listener.Options>({
	event: 'messageReactionRemove'
})
export class LogMessageReactionRemoveListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		this.container.client.logger.info(
			`Reaction removed: user=${user.id} (${user.tag ?? 'unknown'}) | message=${reaction.message.id} | emoji=${reaction.emoji.name}`
		);
	}
}
