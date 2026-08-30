import { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import type { VoiceConnection } from '@discordjs/voice';
import { container } from '@sapphire/framework';
import { getListenerClient, isListenerReady, LISTENER_GROUP } from './listenerClient';

export class ListenerUnavailableError extends Error {
	public constructor() {
		super('Voice receive is not configured. Set DISCORD_LISTENER_TOKEN and invite the listener bot.');
		this.name = 'ListenerUnavailableError';
	}
}

/**
 * Opens a receive connection on the listener client.
 *
 * The connection is built from the *listener's* guild and voiceAdapterCreator, never the main
 * bot's — that separation is the entire point. It is registered under its own group so the two
 * clients' connections cannot collide in @discordjs/voice's guild-keyed registry.
 */
export async function ensureReceiveConnection(guildId: string, channelId: string): Promise<VoiceConnection> {
	const client = getListenerClient();
	if (!client || !isListenerReady()) throw new ListenerUnavailableError();

	const existing = getVoiceConnection(guildId, LISTENER_GROUP);
	if (existing && existing.joinConfig.channelId === channelId) return existing;

	const guild = await client.guilds.fetch(guildId).catch(() => null);
	if (!guild) throw new ListenerUnavailableError();

	const connection = joinVoiceChannel({
		channelId,
		guildId,
		group: LISTENER_GROUP,
		adapterCreator: guild.voiceAdapterCreator,
		selfDeaf: false,
		// Unmuted, though the listener is silent most of the time: a `sound` voice trigger plays
		// its clip back through this connection, and a self-muted connection drops what it sends
		// without erroring, which would look like the clip simply never playing.
		selfMute: false
	});

	// VoiceConnection is an EventEmitter, so an unhandled 'error' is a fatal exception. This
	// has already taken the bot down once.
	connection.on('error', (error) => {
		container.logger.error(`[voice/listener] connection error in guild ${guildId}: ${String(error)}`);
	});

	await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
	return connection;
}

/**
 * Releases the listener's connection.
 *
 * Unconditional, unlike the single-token version this replaces: the listener owns its own voice
 * state, so leaving cannot disconnect the music bot or stop playback.
 */
export function releaseReceiveConnection(guildId: string): void {
	try {
		getVoiceConnection(guildId, LISTENER_GROUP)?.destroy();
	} catch (error) {
		container.logger.error(`[voice/listener] failed to release receive connection: ${String(error)}`);
	}
}
