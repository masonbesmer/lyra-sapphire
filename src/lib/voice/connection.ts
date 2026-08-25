import type { Guild, VoiceBasedChannel } from 'discord.js';
import type { VoiceConnection } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import { getOrCreateVoiceConnection } from '../musicCommandHelpers';

/**
 * Joins undeafened for voice receive. Identical to the connection /record opens —
 * a guild has exactly one gateway voice state, so both must agree on selfDeaf.
 */
export async function ensureReceiveConnection(guild: Guild, channel: VoiceBasedChannel): Promise<VoiceConnection> {
	return getOrCreateVoiceConnection(guild, channel);
}

/**
 * Kazagumo creating a player after the assistant joined can leave the bot deafened,
 * which silently kills reception. Re-assert the flag when the bot's voice state changes.
 */
export async function reassertUndeafened(guildId: string): Promise<void> {
	try {
		const me = container.client.guilds.cache.get(guildId)?.members.me;
		if (!me) return;
		if (me.voice.selfDeaf) await me.voice.setDeaf(false);
	} catch (error) {
		container.logger.error('[voice/connection] failed to reassert undeafened state', error);
	}
}
