import { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import type { VoiceConnection } from '@discordjs/voice';
import { container } from '@sapphire/framework';

/** The group name that namespaces receive connections in @discordjs/voice's registry. */
export const RECEIVE_GROUP = 'receive';

/**
 * Opens a receive connection on the main client.
 *
 * Lyra listens as herself: the connection is built from *her* guild and voiceAdapterCreator,
 * and music plays through the second bot's gateway instead (see ./musicClient), so the two
 * never fight over one voice state. Registered under its own group so nothing else in the
 * guild-keyed registry can collide with it.
 */
export async function ensureReceiveConnection(guildId: string, channelId: string): Promise<VoiceConnection> {
	const existing = getVoiceConnection(guildId, RECEIVE_GROUP);
	if (existing && existing.joinConfig.channelId === channelId) return existing;

	const guild = await container.client.guilds.fetch(guildId);

	const connection = joinVoiceChannel({
		channelId,
		guildId,
		group: RECEIVE_GROUP,
		adapterCreator: guild.voiceAdapterCreator,
		selfDeaf: false,
		// Unmuted, though she is silent most of the time: spoken acks play back through this
		// connection, and a self-muted connection drops what it sends without erroring, which
		// would look like the clip simply never playing.
		selfMute: false
	});

	// VoiceConnection is an EventEmitter, so an unhandled 'error' is a fatal exception. This
	// has already taken the bot down once.
	connection.on('error', (error) => {
		container.logger.error(`[voice/receive] connection error in guild ${guildId}: ${String(error)}`);
	});

	await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
	return connection;
}

/**
 * Releases the receive connection.
 *
 * Unconditional: music holds its own voice state on the second client, so leaving cannot stop
 * playback.
 */
export function releaseReceiveConnection(guildId: string): void {
	try {
		getVoiceConnection(guildId, RECEIVE_GROUP)?.destroy();
	} catch (error) {
		container.logger.error(`[voice/receive] failed to release receive connection: ${String(error)}`);
	}
}
