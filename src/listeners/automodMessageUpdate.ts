import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message, PartialMessage } from 'discord.js';
import { runAutomod } from '../lib/automodActions';

/** Re-checks edited messages against the content filters, so editing a word in doesn't dodge them. */
@ApplyOptions<Listener.Options>({ event: Events.MessageUpdate })
export class AutomodMessageUpdate extends Listener<typeof Events.MessageUpdate> {
	public override async run(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
		if (!newMessage.inGuild()) return;
		// Embeds resolving fire an update too; only a changed text is worth re-checking.
		if (!oldMessage.partial && oldMessage.content === newMessage.content) return;
		const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
		if (message) await runAutomod(message, true);
	}
}
