import type { ChatInputCommandInteraction, Message, User } from 'discord.js';

/**
 * Metadata attached to a discord-player GuildQueue.
 * `interaction` may be null when the track was queued via the WebUI.
 */
export interface QueueMetadata {
	interaction: ChatInputCommandInteraction | Message | null;
	channelId: string;
	requestedBy: User;
}
