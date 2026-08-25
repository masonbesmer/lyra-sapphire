import { Client, GatewayIntentBits } from 'discord.js';
import { container } from '@sapphire/framework';

/**
 * A second gateway client that owns voice *receive*.
 *
 * Lavalink and `@discordjs/voice` cannot share one bot's voice state. A guild has exactly one
 * gateway voice state per bot, so opening receive while music plays never reaches Ready, and
 * opening it first does not survive Lavalink connecting — the stream dies mid-recording. A
 * second Discord application has its own voice state, which removes the contention entirely.
 *
 * This client loads no commands and answers no interactions. It exists to hold a voice
 * connection.
 */
let listener: Client | null = null;
let ready = false;

/** The group name that namespaces this client's connections in @discordjs/voice's registry. */
export const LISTENER_GROUP = 'listener';

export function getListenerClient(): Client | null {
	return listener;
}

export function isListenerReady(): boolean {
	return ready && listener !== null;
}

/**
 * Logs the listener in, if a token is configured. Absent token is not an error: the bot runs
 * normally and only the receive-dependent features are unavailable.
 */
export async function startListenerClient(): Promise<void> {
	const token = process.env.DISCORD_LISTENER_TOKEN;
	if (!token) {
		container.logger.info('[voice/listener] DISCORD_LISTENER_TOKEN is not set; voice receive is disabled.');
		return;
	}

	listener = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

	listener.on('error', (error) => {
		container.logger.error(`[voice/listener] client error: ${String(error)}`);
	});

	listener.once('clientReady', () => {
		ready = true;
		container.logger.info(`[voice/listener] logged in as ${listener?.user?.tag}`);
	});

	try {
		await listener.login(token);
	} catch (error) {
		container.logger.error(`[voice/listener] failed to log in; voice receive is disabled: ${String(error)}`);
		listener = null;
		ready = false;
	}
}
