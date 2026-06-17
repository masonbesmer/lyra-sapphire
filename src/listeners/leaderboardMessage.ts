import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { recordMessage } from '../lib/leaderboard';

@ApplyOptions<Listener.Options>({
	event: Events.MessageCreate
})
export class LeaderboardMessageListener extends Listener<typeof Events.MessageCreate> {
	public override run(message: Message): void {
		if (message.author.bot) return;
		if (message.webhookId) return;
		if (!message.guild) return;
		if (message.system) return;
		recordMessage(message.guild.id, message.author.id);
	}
}
