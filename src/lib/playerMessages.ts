import type { Client, GuildTextBasedChannel, Message } from 'discord.js';
import { db } from './database';

const cache = new Map<string, Message>();

export function getCachedMessage(channelId: string): Message | undefined {
	return cache.get(channelId);
}

export async function storePlayerMessage(channel: GuildTextBasedChannel, message: Message) {
	cache.set(channel.id, message);
	db.prepare('INSERT OR REPLACE INTO player_messages (channel_id, message_id) VALUES (?, ?)').run(channel.id, message.id);
}

export async function deletePlayerMessage(channel: GuildTextBasedChannel) {
	const cached = cache.get(channel.id);
	if (cached) {
		try {
			await cached.delete();
		} catch {
			// ignore
		}
	} else {
		const row = db.prepare('SELECT message_id FROM player_messages WHERE channel_id = ?').get(channel.id) as { message_id: string } | undefined;
		if (row) {
			try {
				const msg = await channel.messages.fetch(row.message_id);
				await msg.delete();
			} catch {
				// ignore
			}
		}
	}
	cache.delete(channel.id);
	db.prepare('DELETE FROM player_messages WHERE channel_id = ?').run(channel.id);
}

export async function cleanupStalePlayerMessages(client: Client) {
	const rows = db.prepare('SELECT channel_id, message_id FROM player_messages').all() as { channel_id: string; message_id: string }[];
	for (const { channel_id, message_id } of rows) {
		try {
			const channel = await client.channels.fetch(channel_id);
			if (channel && channel.isTextBased()) {
				const msg = await channel.messages.fetch(message_id);
				await msg.delete().catch(() => {});
			}
		} catch {
			// ignore fetch or delete errors
		}
		db.prepare('DELETE FROM player_messages WHERE channel_id = ?').run(channel_id);
		cache.delete(channel_id);
	}
}
