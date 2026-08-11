import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import {
	getStarboardConfig,
	getStarboardMessage,
	createStarboardMessage,
	updateStarboardMessageCount,
	buildStarboardEmbed,
	countValidStars,
	emojiMatches,
	isStarboardBlacklisted,
	scheduleStarboardSettle
} from '../lib/starboard';

const SETTLE_DELAY_MS = 5000;

export async function handleReactionChange(this: Listener, reaction: MessageReaction | PartialMessageReaction) {
	try {
		if (reaction.partial) reaction = await reaction.fetch();
	} catch {
		return;
	}

	let message = reaction.message;
	try {
		if (message.partial) message = await message.fetch();
	} catch {
		return;
	}

	if (!message.guild || !message.author) return;
	if (message.author.bot) return;

	const guildId = message.guild.id;
	const config = getStarboardConfig(guildId);
	if (!config.enabled || !config.channel_id) return;
	if (message.channelId === config.channel_id) return;
	if (!emojiMatches(reaction.emoji, config.emoji)) return;
	if (isStarboardBlacklisted(guildId, message.channelId, message.author.id)) return;

	const starboardChannel = message.guild.channels.cache.get(config.channel_id);
	if (!starboardChannel?.isTextBased()) return;

	const originChannel = message.channel;
	const originIsNsfw = 'nsfw' in originChannel && originChannel.nsfw;
	const starboardIsNsfw = 'nsfw' in starboardChannel && starboardChannel.nsfw;
	if (originIsNsfw && !starboardIsNsfw) return;

	// Debounce: rapid react/unreact spam collapses into a single settle per message
	// instead of hitting the Discord API on every single reaction change.
	scheduleStarboardSettle(message.id, SETTLE_DELAY_MS, () => settleStarboard.call(this, message.id, message.channelId, guildId));
}

async function settleStarboard(this: Listener, originalMessageId: string, originalChannelId: string, guildId: string) {
	const config = getStarboardConfig(guildId);
	if (!config.enabled || !config.channel_id) return;

	const guild = this.container.client.guilds.cache.get(guildId);
	if (!guild) return;

	const starboardChannel = guild.channels.cache.get(config.channel_id);
	if (!starboardChannel?.isTextBased()) return;

	const originChannel = guild.channels.cache.get(originalChannelId);
	if (!originChannel?.isTextBased()) return;

	const message = await originChannel.messages.fetch(originalMessageId).catch(() => null);
	if (!message || !message.author) return;

	const matchedReaction = message.reactions.cache.find((r) => emojiMatches(r.emoji, config.emoji));
	const starCount = matchedReaction ? await countValidStars(matchedReaction, message.author.id, config.self_star) : 0;

	const existingEntry = getStarboardMessage(originalMessageId);

	if (existingEntry) {
		updateStarboardMessageCount(originalMessageId, starCount);
		try {
			const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboard_message_id);
			const embed = await buildStarboardEmbed(message, starCount, existingEntry.index_code, config.emoji);
			await starboardMessage.edit({
				content: `${config.emoji} **${starCount}** | <#${message.channelId}>`,
				embeds: [embed]
			});
		} catch (error) {
			this.container.logger.error(`[STARBOARD] Failed to update starboard message: ${error}`);
		}
		return;
	}

	if (starCount >= config.threshold) {
		try {
			const pendingEmbed = await buildStarboardEmbed(message, starCount, 'PENDING', config.emoji);
			const starboardMessage = await starboardChannel.send({
				content: `${config.emoji} **${starCount}** | <#${message.channelId}>`,
				embeds: [pendingEmbed]
			});

			const indexCode = createStarboardMessage(guildId, message.id, message.channelId, starboardMessage.id, starCount);

			const finalEmbed = await buildStarboardEmbed(message, starCount, indexCode, config.emoji);
			await starboardMessage.edit({ embeds: [finalEmbed] });
		} catch (error) {
			this.container.logger.error(`[STARBOARD] Failed to post starboard message: ${error}`);
		}
	}
}

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionRemove })
export class MessageReactionRemoveListener extends Listener<typeof Events.MessageReactionRemove> {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		if (user.bot) return;
		await handleReactionChange.call(this, reaction);
	}
}
