import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message, PartialMessage } from 'discord.js';
import {
	buildStarboardEmbed,
	deleteStarboardMessageByMessageId,
	getStarboardConfig,
	getStarboardMessage,
	getStarboardMessageByStarboardId
} from '../lib/starboard';

@ApplyOptions<Listener.Options>({ event: Events.MessageDelete })
export class StarboardMessageDeleteListener extends Listener<typeof Events.MessageDelete> {
	public async run(message: Message | PartialMessage) {
		if (!message.guildId || !message.guild) return;

		// The original starred message was deleted: remove its starboard copy too.
		const entryForOriginal = getStarboardMessage(message.id);
		if (entryForOriginal) {
			const config = getStarboardConfig(message.guildId);
			if (config.channel_id) {
				const starboardChannel = message.guild.channels.cache.get(config.channel_id);
				if (starboardChannel?.isTextBased()) {
					const starboardMessage = await starboardChannel.messages.fetch(entryForOriginal.starboard_message_id).catch(() => null);
					await starboardMessage?.delete().catch(() => {});
				}
			}
			deleteStarboardMessageByMessageId(message.id);
			return;
		}

		// The posted starboard copy itself was deleted (e.g. by a moderator): drop the orphaned entry.
		const entryForStarboard = getStarboardMessageByStarboardId(message.id);
		if (entryForStarboard) deleteStarboardMessageByMessageId(entryForStarboard.original_message_id);
	}
}

@ApplyOptions<Listener.Options>({ event: Events.MessageUpdate })
export class StarboardMessageUpdateListener extends Listener<typeof Events.MessageUpdate> {
	public async run(_oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
		if (!newMessage.guildId || !newMessage.guild || newMessage.partial) return;

		const entry = getStarboardMessage(newMessage.id);
		if (!entry) return;

		const config = getStarboardConfig(newMessage.guildId);
		if (!config.channel_id) return;

		const starboardChannel = newMessage.guild.channels.cache.get(config.channel_id);
		if (!starboardChannel?.isTextBased()) return;

		const starboardMessage = await starboardChannel.messages.fetch(entry.starboard_message_id).catch(() => null);
		if (!starboardMessage) return;

		const embed = await buildStarboardEmbed(newMessage as Message, entry.star_count, entry.index_code, config.emoji);
		await starboardMessage.edit({ embeds: [embed] }).catch((error) => {
			this.container.logger.debug(`[STARBOARD] Failed to sync edited message to starboard: ${error}`);
		});
	}
}
