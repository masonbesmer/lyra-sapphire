import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Message } from 'discord.js';
import { db } from '../lib/database';

@ApplyOptions<Listener.Options>({
	event: 'messageCreate'
})
export class UserEvent extends Listener {
	public override async run(message: Message) {
		if (message.author.bot) return;

		const msgText = message.content.toLowerCase();

		try {
			const rows = db.prepare("SELECT keyword, response FROM word_triggers WHERE ? LIKE '%' || keyword || '%'").all(msgText) as {
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
