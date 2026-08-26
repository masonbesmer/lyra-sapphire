import { db } from './database';
import { container } from '@sapphire/framework';
import { EmbedBuilder, type Message } from 'discord.js';

export interface StarboardConfig {
	guild_id: string;
	channel_id: string | null;
	threshold: number;
	emoji: string;
	enabled: boolean;
	self_star: boolean;
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

export type BlacklistTargetType = 'channel' | 'user';

interface StarboardConfigRow {
	guild_id: string;
	channel_id: string | null;
	threshold: number;
	emoji: string | null;
	enabled: number | null;
	self_star: number | null;
}

const DEFAULT_EMOJI = '⭐';
const DEFAULT_THRESHOLD = 3;

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
 * Get starboard configuration for a guild (with defaults applied)
 */
export function getStarboardConfig(guildId: string): StarboardConfig {
	const row = db.prepare('SELECT * FROM starboard_config WHERE guild_id = ?').get(guildId) as StarboardConfigRow | undefined;
	if (!row) {
		return { guild_id: guildId, channel_id: null, threshold: DEFAULT_THRESHOLD, emoji: DEFAULT_EMOJI, enabled: true, self_star: true };
	}
	return {
		guild_id: row.guild_id,
		channel_id: row.channel_id,
		threshold: row.threshold ?? DEFAULT_THRESHOLD,
		emoji: row.emoji ?? DEFAULT_EMOJI,
		enabled: row.enabled === null || row.enabled === undefined ? true : row.enabled !== 0,
		self_star: row.self_star === null || row.self_star === undefined ? true : row.self_star !== 0
	};
}

function upsertStarboardConfig(guildId: string, patch: Partial<Omit<StarboardConfig, 'guild_id'>>): void {
	const curr = getStarboardConfig(guildId);
	const next = { ...curr, ...patch };
	db.prepare(
		`INSERT INTO starboard_config (guild_id, channel_id, threshold, emoji, enabled, self_star)
		VALUES (@guild_id, @channel_id, @threshold, @emoji, @enabled, @self_star)
		ON CONFLICT(guild_id) DO UPDATE SET
		channel_id=excluded.channel_id,
		threshold=excluded.threshold,
		emoji=excluded.emoji,
		enabled=excluded.enabled,
		self_star=excluded.self_star`
	).run({
		guild_id: guildId,
		channel_id: next.channel_id,
		threshold: next.threshold,
		emoji: next.emoji,
		enabled: next.enabled ? 1 : 0,
		self_star: next.self_star ? 1 : 0
	});
}

/** Set starboard channel for a guild - null clears it, which parks the starboard until one is set. */
export function setStarboardChannel(guildId: string, channelId: string | null): void {
	upsertStarboardConfig(guildId, { channel_id: channelId });
}

/** Set starboard threshold for a guild */
export function setStarboardThreshold(guildId: string, threshold: number): void {
	upsertStarboardConfig(guildId, { threshold });
}

/** Set the reaction emoji used to trigger the starboard for a guild */
export function setStarboardEmoji(guildId: string, emoji: string): void {
	upsertStarboardConfig(guildId, { emoji });
}

/** Enable or disable the starboard for a guild without losing the rest of the config */
export function setStarboardEnabled(guildId: string, enabled: boolean): void {
	upsertStarboardConfig(guildId, { enabled });
}

/** Toggle whether users are allowed to star their own messages */
export function setStarboardSelfStar(guildId: string, allowed: boolean): void {
	upsertStarboardConfig(guildId, { self_star: allowed });
}

/** Get starboard message by original message ID */
export function getStarboardMessage(originalMessageId: string): StarboardMessage | null {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE original_message_id = ?');
	return (stmt.get(originalMessageId) as StarboardMessage | undefined) ?? null;
}

/** Get starboard message by the ID of the posted starboard copy */
export function getStarboardMessageByStarboardId(starboardMessageId: string): StarboardMessage | null {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE starboard_message_id = ?');
	return (stmt.get(starboardMessageId) as StarboardMessage | undefined) ?? null;
}

/** Get starboard message by index code */
export function getStarboardMessageByIndex(indexCode: string): StarboardMessage | null {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE index_code = ?');
	return (stmt.get(indexCode) as StarboardMessage | undefined) ?? null;
}

/** Create a new starboard entry */
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

/** Update star count for a starboard message */
export function updateStarboardMessageCount(originalMessageId: string, starCount: number): void {
	const stmt = db.prepare('UPDATE starboard_messages SET star_count = ? WHERE original_message_id = ?');
	stmt.run(starCount, originalMessageId);
}

/** Delete starboard message by index code */
export function deleteStarboardMessage(indexCode: string): boolean {
	const stmt = db.prepare('DELETE FROM starboard_messages WHERE index_code = ?');
	const result = stmt.run(indexCode);
	return result.changes > 0;
}

/** Delete starboard message by original message ID */
export function deleteStarboardMessageByMessageId(originalMessageId: string): boolean {
	const stmt = db.prepare('DELETE FROM starboard_messages WHERE original_message_id = ?');
	const result = stmt.run(originalMessageId);
	return result.changes > 0;
}

/** Get all starboard messages for a guild */
export function getStarboardMessages(guildId: string): StarboardMessage[] {
	const stmt = db.prepare('SELECT * FROM starboard_messages WHERE guild_id = ? ORDER BY star_count DESC');
	return stmt.all(guildId) as StarboardMessage[];
}

/** Add a channel or user to a guild's starboard blacklist */
export function addToStarboardBlacklist(guildId: string, targetId: string, type: BlacklistTargetType): void {
	db.prepare(`INSERT OR IGNORE INTO starboard_blacklist (guild_id, target_id, target_type) VALUES (?, ?, ?)`).run(guildId, targetId, type);
}

/** Remove a channel or user from a guild's starboard blacklist */
export function removeFromStarboardBlacklist(guildId: string, targetId: string, type: BlacklistTargetType): boolean {
	const result = db
		.prepare(`DELETE FROM starboard_blacklist WHERE guild_id = ? AND target_id = ? AND target_type = ?`)
		.run(guildId, targetId, type);
	return result.changes > 0;
}

/** List all blacklisted channels/users for a guild */
export function getStarboardBlacklist(guildId: string): { target_id: string; target_type: BlacklistTargetType }[] {
	return db.prepare(`SELECT target_id, target_type FROM starboard_blacklist WHERE guild_id = ?`).all(guildId) as {
		target_id: string;
		target_type: BlacklistTargetType;
	}[];
}

/** Whether a message's channel or author is blacklisted from the starboard */
export function isStarboardBlacklisted(guildId: string, channelId: string, authorId: string): boolean {
	const row = db
		.prepare(
			`SELECT 1 FROM starboard_blacklist WHERE guild_id = ? AND ((target_type = 'channel' AND target_id = ?) OR (target_type = 'user' AND target_id = ?)) LIMIT 1`
		)
		.get(guildId, channelId, authorId);
	return row !== undefined;
}

interface ReactionEmojiLike {
	id: string | null;
	name: string | null;
	animated?: boolean | null;
}

/** Render a reaction emoji as the string form we store in config (unicode char, or <a?:name:id> mention) */
export function emojiIdentifier(emoji: ReactionEmojiLike): string {
	if (emoji.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
	return emoji.name ?? '';
}

/** Whether a reaction's emoji matches the guild's configured starboard emoji */
export function emojiMatches(emoji: ReactionEmojiLike, configuredEmoji: string): boolean {
	return emojiIdentifier(emoji) === configuredEmoji;
}

interface CountableReaction {
	users: { fetch(): Promise<Map<string, { id: string; bot: boolean }>> };
}

/**
 * Recount the "real" star total for a reaction: excludes bot reactions, and excludes
 * the message author's own reaction unless self-starring is allowed for the guild.
 */
export async function countValidStars(reaction: CountableReaction, authorId: string, selfStarAllowed: boolean): Promise<number> {
	const users = await reaction.users.fetch();
	let count = 0;
	for (const user of users.values()) {
		if (user.bot) continue;
		if (!selfStarAllowed && user.id === authorId) continue;
		count++;
	}
	return count;
}

const pendingSettles = new Map<string, NodeJS.Timeout>();

/**
 * Debounce a starboard settle task per message so rapid reaction add/remove spam
 * collapses into a single Discord API call instead of hammering it on every event.
 */
export function scheduleStarboardSettle(key: string, delayMs: number, task: () => Promise<void>): void {
	const existing = pendingSettles.get(key);
	if (existing) clearTimeout(existing);
	const timeout = setTimeout(() => {
		pendingSettles.delete(key);
		task().catch((error) => container.logger.error(`[STARBOARD] Failed to settle starboard update: ${error}`));
	}, delayMs);
	pendingSettles.set(key, timeout);
}

/** Build starboard embed for a message */
export async function buildStarboardEmbed(message: Message, starCount: number, indexCode: string, emoji = DEFAULT_EMOJI): Promise<EmbedBuilder> {
	const embed = new EmbedBuilder()
		.setColor('#FFD700')
		.setAuthor({
			name: message.author.username,
			iconURL: message.author.displayAvatarURL()
		})
		.setDescription(message.content || '*No text content*')
		.addFields([
			{ name: 'Source', value: `[Jump to message](${message.url})`, inline: true },
			{ name: 'Stars', value: `${emoji} ${starCount}`, inline: true },
			{ name: 'Index', value: indexCode, inline: true }
		])
		.setTimestamp(message.createdAt)
		.setFooter({ text: `Message ID: ${message.id}` });

	const attachments = [...message.attachments.values()];
	const images = attachments.filter((a) => a.contentType?.startsWith('image/'));
	if (images[0]) embed.setImage(images[0].url);

	const extraCount = attachments.length - (images[0] ? 1 : 0);
	if (extraCount > 0) {
		embed.addFields([{ name: 'Attachments', value: `+${extraCount} more`, inline: true }]);
	}

	return embed;
}
