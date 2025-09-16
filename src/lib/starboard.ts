import { db } from './database';
import { EmbedBuilder, type Message, type GuildTextBasedChannel } from 'discord.js';

export interface StarboardConfig {
	guild_id: string;
	channel_id: string | null;
	threshold: number;
}

export interface StarboardMessage {
	id: string;
	guild_id: string;
	original_message_id: string;
	original_channel_id: string;
	starboard_message_id: string;
	star_count: number;
	index_code: string;
}

/**
 * Generate a random 5-digit alphanumeric index
 */
export function generateStarboardIndex(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let result = '';
	for (let i = 0; i < 5; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

/**
 * Get starboard configuration for a guild
 */
export function getStarboardConfig(guildId: string): StarboardConfig | null {
	const stmt = db.prepare('SELECT * FROM starboard_config WHERE guild_id = ?');
	return stmt.get(guildId) as StarboardConfig | null;
}

/**
 * Set starboard channel for a guild
 */
export function setStarboardChannel(guildId: string, channelId: string): void {
	const stmt = db.prepare(`
		INSERT INTO starboard_config (guild_id, channel_id, threshold)
		VALUES (?, ?, 3)
		ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
	`);
	stmt.run(guildId, channelId);
}

/**
 * Set starboard threshold for a guild
 */
export function setStarboardThreshold(guildId: string, threshold: number): void {
	const stmt = db.prepare(`
		INSERT INTO starboard_config (guild_id, threshold)
		VALUES (?, ?)
		ON CONFLICT(guild_id) DO UPDATE SET threshold = excluded.threshold
	`);
	stmt.run(guildId, threshold);
}

/**
 * Get starboard message by original message ID
 */
export function getStarboardMessage(originalMessageId: string): StarboardMessage | null {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE original_message_id = ?');
	return stmt.get(originalMessageId) as StarboardMessage | null;
}

/**
 * Get starboard message by index code
 */
export function getStarboardMessageByIndex(indexCode: string): StarboardMessage | null {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE index_code = ?');
	return stmt.get(indexCode) as StarboardMessage | null;
}

/**
 * Create a new starboard entry
 */
export function createStarboardMessage(
	guildId: string,
	originalMessageId: string,
	originalChannelId: string,
	starboardMessageId: string,
	starCount: number
): string {
	let indexCode: string;
	let attempts = 0;
	const maxAttempts = 10;

	// Generate unique index code
	do {
		indexCode = generateStarboardIndex();
		attempts++;
	} while (getStarboardMessageByIndex(indexCode) !== null && attempts < maxAttempts);

	if (attempts >= maxAttempts) {
		throw new Error('Failed to generate unique starboard index');
	}

	const stmt = db.prepare(`
		INSERT INTO starboard_messages 
		(id, guild_id, original_message_id, original_channel_id, starboard_message_id, star_count, index_code)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);

	const id = `${guildId}-${originalMessageId}`;
	stmt.run(id, guildId, originalMessageId, originalChannelId, starboardMessageId, starCount, indexCode);
	return indexCode;
}

/**
 * Update star count for a starboard message
 */
export function updateStarboardMessageCount(originalMessageId: string, starCount: number): void {
	const stmt = db.prepare('UPDATE starboard_messages SET star_count = ? WHERE original_message_id = ?');
	stmt.run(starCount, originalMessageId);
}

/**
 * Delete starboard message by index code
 */
export function deleteStarboardMessage(indexCode: string): boolean {
	const stmt = db.prepare('DELETE FROM starboard_messages WHERE index_code = ?');
	const result = stmt.run(indexCode);
	return result.changes > 0;
}

/**
 * Delete starboard message by original message ID
 */
export function deleteStarboardMessageByMessageId(originalMessageId: string): boolean {
	const stmt = db.prepare('DELETE FROM starboard_messages WHERE original_message_id = ?');
	const result = stmt.run(originalMessageId);
	return result.changes > 0;
}

/**
 * Get all starboard messages for a guild
 */
export function getStarboardMessages(guildId: string): StarboardMessage[] {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE guild_id = ? ORDER BY star_count DESC');
	return stmt.all(guildId) as StarboardMessage[];
}

/**
 * Build starboard embed for a message
 */
export async function buildStarboardEmbed(message: Message, starCount: number, indexCode: string): Promise<EmbedBuilder> {
	const embed = new EmbedBuilder()
		.setColor('#FFD700') // Gold color for stars
		.setAuthor({
			name: message.author.username,
			iconURL: message.author.displayAvatarURL()
		})
		.setDescription(message.content || '*No text content*')
		.addFields([
			{ name: 'Channel', value: `<#${message.channelId}>`, inline: true },
			{ name: 'Stars', value: `⭐ ${starCount}`, inline: true },
			{ name: 'Index', value: indexCode, inline: true }
		])
		.setTimestamp(message.createdAt)
		.setFooter({ text: `Message ID: ${message.id}` });

	// Add attachments if any
	if (message.attachments.size > 0) {
		const attachment = message.attachments.first();
		if (attachment && attachment.contentType?.startsWith('image/')) {
			embed.setImage(attachment.url);
		}
	}

	return embed;
}
