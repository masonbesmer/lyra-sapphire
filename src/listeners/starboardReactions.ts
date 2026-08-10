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
	emojiIdentifier,
	emojiMatches,
	isStarboardBlacklisted,
	scheduleStarboardSettle
} from '../lib/starboard';

const SETTLE_DELAY_MS = 5000;

async function handleReactionChange(this: Listener, reaction: MessageReaction | PartialMessageReaction) {
	try {
		if (reaction.partial) reaction = await reaction.fetch();
	} catch (error) {
		this.container.logger.debug(`[STARBOARD] Failed to fetch partial reaction: ${error}`);
		return;
	}

	let message = reaction.message;
	try {
		if (message.partial) message = await message.fetch();
	} catch (error) {
		this.container.logger.debug(`[STARBOARD] Failed to fetch partial message: ${error}`);
		return;
	}

	if (!message.guild || !message.author) return;
	if (message.author.bot) return;

	const guildId = message.guild.id;
	const config = getStarboardConfig(guildId);
	if (!config.enabled || !config.channel_id) {
		this.container.logger.debug(`[STARBOARD] Ignoring: enabled=${config.enabled}, channel_id=${config.channel_id}`);
		return;
	}
	if (message.channelId === config.channel_id) {
		this.container.logger.debug(`[STARBOARD] Ignoring: reaction on message already in starboard channel`);
		return;
	}
	if (!emojiMatches(reaction.emoji, config.emoji)) {
		this.container.logger.debug(
			`[STARBOARD] Ignoring: emoji mismatch, got "${reaction.emoji.name}" (id=${reaction.emoji.id}), configured "${config.emoji}"`
		);
		return;
	}
	if (isStarboardBlacklisted(guildId, message.channelId, message.author.id)) {
		this.container.logger.debug(`[STARBOARD] Ignoring: channel or author blacklisted`);
		return;
	}

	const starboardChannel = message.guild.channels.cache.get(config.channel_id);
	if (!starboardChannel?.isTextBased()) {
		this.container.logger.debug(`[STARBOARD] Ignoring: starboard channel ${config.channel_id} not found or not text-based`);
		return;
	}

	const originChannel = message.channel;
	const originIsNsfw = 'nsfw' in originChannel && originChannel.nsfw;
	const starboardIsNsfw = 'nsfw' in starboardChannel && starboardChannel.nsfw;
	if (originIsNsfw && !starboardIsNsfw) {
		this.container.logger.debug(`[STARBOARD] Ignoring: NSFW origin channel, non-NSFW starboard channel`);
		return;
	}

	this.container.logger.debug(`[STARBOARD] Scheduling settle for message ${message.id} in ${message.channelId}`);

	// Debounce: rapid react/unreact spam collapses into a single settle per message
	// instead of hitting the Discord API on every single reaction change.
	scheduleStarboardSettle(message.id, SETTLE_DELAY_MS, () => settleStarboard.call(this, message.id, message.channelId, guildId));
}

async function settleStarboard(this: Listener, originalMessageId: string, originalChannelId: string, guildId: string) {
	const config = getStarboardConfig(guildId);
	if (!config.enabled || !config.channel_id) {
		this.container.logger.debug(`[STARBOARD] Settle aborted: enabled=${config.enabled}, channel_id=${config.channel_id}`);
		return;
	}

	const guild = this.container.client.guilds.cache.get(guildId);
	if (!guild) {
		this.container.logger.debug(`[STARBOARD] Settle aborted: guild ${guildId} not cached`);
		return;
	}

	const starboardChannel = guild.channels.cache.get(config.channel_id);
	if (!starboardChannel?.isTextBased()) {
		this.container.logger.debug(`[STARBOARD] Settle aborted: starboard channel ${config.channel_id} not found or not text-based`);
		return;
	}

	const originChannel = guild.channels.cache.get(originalChannelId);
	if (!originChannel?.isTextBased()) {
		this.container.logger.debug(`[STARBOARD] Settle aborted: origin channel ${originalChannelId} not found or not text-based`);
		return;
	}

	const message = await originChannel.messages.fetch(originalMessageId).catch((error) => {
		this.container.logger.debug(`[STARBOARD] Failed to fetch original message ${originalMessageId}: ${error}`);
		return null;
	});
	if (!message || !message.author) return;

	const cachedReactions = [...message.reactions.cache.values()].map((r) => `${emojiIdentifier(r.emoji)}(count=${r.count})`).join(', ') || 'none';
	this.container.logger.debug(`[STARBOARD] Message ${originalMessageId} cached reactions: ${cachedReactions}, configured emoji: "${config.emoji}"`);

	const matchedReaction = message.reactions.cache.find((r) => emojiMatches(r.emoji, config.emoji));
	const starCount = matchedReaction ? await countValidStars(matchedReaction, message.author.id, config.self_star) : 0;

	this.container.logger.debug(
		`[STARBOARD] Settling message ${originalMessageId}: starCount=${starCount}, threshold=${config.threshold}, matchedReaction=${!!matchedReaction}`
	);

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

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionAdd })
export class MessageReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		if (user.bot) return;
		await handleReactionChange.call(this, reaction);
	}
}

@ApplyOptions<Listener.Options>({ event: Events.MessageReactionRemove })
export class MessageReactionRemoveListener extends Listener<typeof Events.MessageReactionRemove> {
	public async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		if (user.bot) return;
		await handleReactionChange.call(this, reaction);
	}
}
