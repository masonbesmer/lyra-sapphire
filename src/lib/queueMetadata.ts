import type { ChatInputCommandInteraction, Message, User } from 'discord.js';

/**
 * Metadata stored in KazagumoPlayer.data under the key 'meta'.
 * Access via: player.data.get('meta') as PlayerMeta | undefined
 */
export interface PlayerMeta {
	interaction: ChatInputCommandInteraction | Message | null;
	channelId: string;
	requestedBy: User;
}

export const PLAYER_META_KEY = 'meta';

/** @deprecated Alias for PlayerMeta — use PlayerMeta instead */
export type QueueMetadata = PlayerMeta;
