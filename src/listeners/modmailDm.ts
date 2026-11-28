import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { dmTicketPrompt, ticketGuildsFor } from '../lib/modQueueActions';

/** One prompt per member per minute, so a burst of DMs doesn't get a burst of prompts. */
const PROMPT_COOLDOWN_MS = 60_000;
const lastPrompt = new Map<string, number>();

/** Looks like a command (`%play …`, `lyra, …`) rather than a message for the moderators. */
export function looksLikeCommand(content: string): boolean {
	return /^\s*(%|(hey +)?lyra[,! ])/i.test(content);
}

/**
 * Modmail (LYRA-12): a DM to Lyra offers to open a ticket in each shared server that takes them.
 * Nothing is sent to staff until the member presses a button.
 */
@ApplyOptions<Listener.Options>({ event: Events.MessageCreate })
export class ModmailDmListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (message.inGuild() || message.author.bot || message.author.system) return;
		if (!message.content.trim() || looksLikeCommand(message.content)) return;
		const now = Date.now();
		if (now - (lastPrompt.get(message.author.id) ?? 0) < PROMPT_COOLDOWN_MS) return;

		const guilds = await ticketGuildsFor(message.author);
		if (!guilds.length) return;
		lastPrompt.set(message.author.id, now);
		await message
			.reply(dmTicketPrompt(guilds, message.id))
			.catch((error) => this.container.logger.debug(`[modmail] couldn't prompt: ${String(error)}`));
	}
}
