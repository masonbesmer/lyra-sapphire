import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Message } from 'discord.js';
import { db } from '../lib/database';
import { isTriggerChannelExcluded } from '../lib/config';

@ApplyOptions<Listener.Options>({
	event: 'messageCreate'
})
export class UserEvent extends Listener {
	public override async run(message: Message) {
		if (message.author.bot && !this.container.client.chaosEnabled) return;
		// Triggers are guild-scoped; a DM has no guild to match against.
		if (!message.guildId) return;
		// Excluding a channel covers its threads too: a thread is part of the conversation in
		// the channel it hangs off, and someone who silenced #general did not mean "except in
		// every thread in #general".
		const parentId = message.channel.isThread() ? message.channel.parentId : null;
		if (isTriggerChannelExcluded(message.guildId, message.channelId)) return;
		if (parentId && isTriggerChannelExcluded(message.guildId, parentId)) return;

		const msgText = message.content.toLowerCase();

		try {
			const rows = db
				.prepare("SELECT keyword, response FROM word_triggers WHERE guild_id = ? AND ? LIKE '%' || keyword || '%'")
				.all(message.guildId, msgText) as {
				keyword: string;
				response: string;
			}[];

			for (const row of rows) {
				await message.reply(row.response);
			}
		} catch (error) {
			this.container.logger.error(`Database error: ${String(error)}`);
		}
	}
}
