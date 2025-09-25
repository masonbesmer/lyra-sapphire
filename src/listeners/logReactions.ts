import { ApplyOptions } from '@sapphire/decorators';
import { Listener, container } from '@sapphire/framework';
import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: 'messageReactionAdd'
})
export class LogReactionAddListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		container.logger.info(`[LOG LISTENER] Reaction add listener triggered!`);
		container.logger.debug(
			`Reaction added: user=${user.id} (${user.tag ?? 'unknown'}) | message=${reaction.message.id} | emoji=${reaction.emoji.name}`
		);
	}
}

@ApplyOptions<Listener.Options>({
	event: 'messageReactionRemove'
})
export class LogReactionRemoveListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		container.logger.info(`[LOG LISTENER] Reaction remove listener triggered!`);
		container.logger.debug(
			`Reaction removed: user=${user.id} (${user.tag ?? 'unknown'}) | message=${reaction.message.id} | emoji=${reaction.emoji.name}`
		);
	}
}
