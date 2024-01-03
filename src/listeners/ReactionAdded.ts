import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { MessageReaction, User } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: 'messageReactionAdd'
})
export class UserEvent extends Listener {
	public override async run(messageReaction: MessageReaction, user: User) {
		// const ID = user.id;
		// return messageReaction.message.channel.send(
		// 	`<@${ID}>, reactions are known to the state of California to cause cancer and reproductive harm. Please be careful when using and adding reactions.`
		// );
	}
}
