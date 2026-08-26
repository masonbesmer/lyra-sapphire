import type { Events } from '@sapphire/framework';
import { Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';

export class UserEvent extends Listener<typeof Events.MentionPrefixOnly> {
	public override run(message: Message) {
		// Do nothing if we cannot send messages in the channel (eg. group DMs)
		if (!message.channel.isSendable()) return;

		const prefix = this.container.client.options.defaultPrefix;
		return message.channel.send(prefix ? `my prefix here is \`${prefix}\`.` : "I don't have a prefix set for message commands.");
	}
}
