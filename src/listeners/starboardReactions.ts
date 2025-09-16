import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';
import {
	getStarboardConfig,
	getStarboardMessage,
	createStarboardMessage,
	updateStarboardMessageCount,
	deleteStarboardMessageByMessageId,
	buildStarboardEmbed
} from '../lib/starboard';

@ApplyOptions<Listener.Options>({
	event: 'messageReactionAdd'
})
export class MessageReactionAddListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		// Ignore bot reactions
		if (user.bot) return;

		// Handle partial reactions/messages
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				this.container.logger.error(`Failed to fetch partial reaction: ${error}`);
				return;
			}
		}

		if (reaction.message.partial) {
			try {
				await reaction.message.fetch();
			} catch (error) {
				this.container.logger.error(`Failed to fetch partial message: ${error}`);
				return;
			}
		}

		// Only handle star reactions
		if (reaction.emoji.name !== '⭐') return;

		// Only handle guild messages
		if (!reaction.message.guild) return;

		// Don't starboard messages from bots
		if (reaction.message.author?.bot) return;

		const guildId = reaction.message.guild.id;
		const config = getStarboardConfig(guildId);

		// Return if no starboard is configured
		if (!config || !config.channel_id) return;

		const starboardChannel = reaction.message.guild.channels.cache.get(config.channel_id);
		if (!starboardChannel?.isTextBased()) return;

		// Don't starboard messages from the starboard channel itself
		if (reaction.message.channelId === config.channel_id) return;

		const starCount = reaction.count ?? 0;
		const existingEntry = getStarboardMessage(reaction.message.id);

		try {
			if (existingEntry) {
				// Update existing starboard message
				if (starCount >= config.threshold) {
					updateStarboardMessageCount(reaction.message.id, starCount);

					// Update the starboard message
					try {
						const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboard_message_id);
						const embed = await buildStarboardEmbed(reaction.message, starCount, existingEntry.index_code);
						await starboardMessage.edit({
							content: `⭐ **${starCount}** | <#${reaction.message.channelId}>`,
							embeds: [embed]
						});
					} catch (error) {
						this.container.logger.error(`Failed to update starboard message: ${error}`);
					}
				}
			} else {
				// Create new starboard entry if threshold is met
				if (starCount >= config.threshold) {
					const embed = await buildStarboardEmbed(reaction.message, starCount, 'TEMP');

					const starboardMessage = await starboardChannel.send({
						content: `⭐ **${starCount}** | <#${reaction.message.channelId}>`,
						embeds: [embed]
					});

					const indexCode = createStarboardMessage(
						guildId,
						reaction.message.id,
						reaction.message.channelId,
						starboardMessage.id,
						starCount
					);

					// Update the embed with the real index code
					const finalEmbed = await buildStarboardEmbed(reaction.message, starCount, indexCode);
					await starboardMessage.edit({
						content: `⭐ **${starCount}** | <#${reaction.message.channelId}>`,
						embeds: [finalEmbed]
					});
				}
			}
		} catch (error) {
			this.container.logger.error(`Error handling starboard reaction: ${error}`);
		}
	}
}

@ApplyOptions<Listener.Options>({
	event: 'messageReactionRemove'
})
export class MessageReactionRemoveListener extends Listener {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		// Ignore bot reactions
		if (user.bot) return;

		// Handle partial reactions/messages
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				this.container.logger.error(`Failed to fetch partial reaction: ${error}`);
				return;
			}
		}

		if (reaction.message.partial) {
			try {
				await reaction.message.fetch();
			} catch (error) {
				this.container.logger.error(`Failed to fetch partial message: ${error}`);
				return;
			}
		}

		// Only handle star reactions
		if (reaction.emoji.name !== '⭐') return;

		// Only handle guild messages
		if (!reaction.message.guild) return;

		const guildId = reaction.message.guild.id;
		const config = getStarboardConfig(guildId);

		// Return if no starboard is configured
		if (!config || !config.channel_id) return;

		const existingEntry = getStarboardMessage(reaction.message.id);
		if (!existingEntry) return;

		const starboardChannel = reaction.message.guild.channels.cache.get(config.channel_id);
		if (!starboardChannel?.isTextBased()) return;

		const starCount = reaction.count ?? 0;

		try {
			if (starCount >= config.threshold) {
				// Update existing starboard message
				updateStarboardMessageCount(reaction.message.id, starCount);

				try {
					const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboard_message_id);
					const embed = await buildStarboardEmbed(reaction.message, starCount, existingEntry.index_code);
					await starboardMessage.edit({
						content: `⭐ **${starCount}** | <#${reaction.message.channelId}>`,
						embeds: [embed]
					});
				} catch (error) {
					this.container.logger.error(`Failed to update starboard message: ${error}`);
				}
			} else {
				// Remove from starboard if below threshold
				try {
					const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboard_message_id);
					await starboardMessage.delete();
				} catch (error) {
					// Message might already be deleted, ignore
				}

				// Remove from database
				deleteStarboardMessageByMessageId(reaction.message.id);
			}
		} catch (error) {
			this.container.logger.error(`Error handling starboard reaction removal: ${error}`);
		}
	}
}
