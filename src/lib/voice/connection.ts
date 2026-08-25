import type { Guild, VoiceBasedChannel } from 'discord.js';
import type { VoiceConnection } from '@discordjs/voice';
import { getVoiceConnection } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import { getOrCreateVoiceConnection } from '../musicCommandHelpers';

/**
 * Opens a connection suitable for voice *receive*.
 *
 * A guild has exactly one gateway voice state, and Kazagumo creates its players with
 * `deaf: true`. Whichever subsystem moved last therefore decides whether we are deafened,
 * and a deafened bot receives no audio at all — the recording succeeds and the WAV is
 * silence, with no error anywhere. Re-assert the flag once we are Ready.
 */
export async function ensureReceiveConnection(guild: Guild, channel: VoiceBasedChannel): Promise<VoiceConnection> {
	const connection = await getOrCreateVoiceConnection(guild, channel);
	connection.rejoin({ channelId: channel.id, selfDeaf: false, selfMute: true });
	return connection;
}

/**
 * Releases a receive connection once nothing needs to receive any more.
 *
 * Leaving it open is not free: Kazagumo destroys the gateway session of a connection it has
 * no player for, and the orphaned VoiceConnection then errors on the closed socket. But
 * destroying it sends channel_id: null, which disconnects the bot outright — so only do it
 * when Lavalink has no player here, otherwise music would stop.
 */
export function releaseReceiveConnection(guildId: string): void {
	try {
		if (container.client.kazagumo.getPlayer(guildId)) return;
		getVoiceConnection(guildId)?.destroy();
	} catch (error) {
		container.logger.error(`[voice/connection] failed to release receive connection: ${String(error)}`);
	}
}

/**
 * Undeafens the bot if something re-deafened it — e.g. a Kazagumo player created after
 * we joined.
 *
 * `selfDeaf` is part of the gateway voice state, so it can only be changed by re-sending
 * OP4. `GuildMember#voice.setDeaf()` would set *server* deafen instead and needs the
 * DeafenMembers permission, which is a different flag entirely.
 */
export async function reassertUndeafened(guildId: string): Promise<void> {
	try {
		const me = container.client.guilds.cache.get(guildId)?.members.me;
		if (!me?.voice.selfDeaf) return;
		const connection = getVoiceConnection(guildId);
		const channelId = connection?.joinConfig.channelId;
		if (!connection || !channelId) return;
		connection.rejoin({ channelId, selfDeaf: false, selfMute: true });
	} catch (error) {
		container.logger.error(`[voice/connection] failed to reassert undeafened state: ${String(error)}`);
	}
}
