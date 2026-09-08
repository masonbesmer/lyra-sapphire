import { Client, GatewayIntentBits } from 'discord.js';
import { container } from '@sapphire/framework';

/**
 * A second gateway client that owns music *playback*.
 *
 * Lavalink and `@discordjs/voice` cannot share one bot's voice state. A guild has exactly one
 * gateway voice state per bot, so whichever of the two opens second kills the first. A second
 * Discord application has its own voice state, which removes the contention entirely.
 *
 * Lyra herself is the one that joins to listen — the assistant, `/record`, and spoken acks all
 * run on the main client — so this client is the one Lavalink drives: it joins only when music
 * is played, and it loads no commands and answers no interactions.
 *
 * Without a token for it, Kazagumo falls back to the main client and the two features contend
 * for the same voice state again, exactly as they did before the split.
 */
let musicClient: Client | null = null;
let ready = false;

/** Builds the music client, if a token is configured. Must run before Kazagumo is constructed. */
export function createMusicClient(): Client | null {
	// DISCORD_LISTENER_TOKEN is the same secret under its old name, from when this client did
	// the listening. Deployments that still set it keep working.
	const token = process.env.DISCORD_MUSIC_TOKEN ?? process.env.DISCORD_LISTENER_TOKEN;
	if (!token) {
		container.logger.info('[voice/music] DISCORD_MUSIC_TOKEN is not set; music shares the main bot voice state.');
		return null;
	}

	musicClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

	musicClient.on('error', (error) => {
		container.logger.error(`[voice/music] client error: ${String(error)}`);
	});

	musicClient.once('clientReady', () => {
		ready = true;
		container.logger.info(`[voice/music] logged in as ${musicClient?.user?.tag}`);
	});

	return musicClient;
}

/** The separate music client, or null when music runs on the main client. */
export function getMusicClient(): Client | null {
	return musicClient;
}

export function isMusicClientReady(): boolean {
	return ready && musicClient !== null;
}

/** The client whose gateway carries music voice state — the second bot when there is one. */
export function getMusicGatewayClient(): Client {
	return musicClient ?? container.client;
}

/**
 * Logs the music client in.
 *
 * Shoukaku connects its nodes on this client's `clientReady`, so a failure here leaves music
 * unavailable until the token is fixed. The rest of the bot still runs, which is why this is
 * logged rather than fatal.
 */
export async function startMusicClient(): Promise<void> {
	if (!musicClient) return;

	try {
		await musicClient.login(process.env.DISCORD_MUSIC_TOKEN ?? process.env.DISCORD_LISTENER_TOKEN);
	} catch (error) {
		container.logger.error(`[voice/music] failed to log in; music is unavailable: ${String(error)}`);
	}
}

/**
 * The channel the music bot is in, or null.
 *
 * The player is asked first: it knows where Lavalink was told to play even before the second
 * client's own voice state has caught up. Callers use this to gate player controls, so it must
 * never answer with the *main* bot's channel — that one is the assistant's, and gating music on
 * it would lock the player out whenever Lyra is listening elsewhere.
 */
export function getMusicBotChannelId(guildId: string): string | null {
	const player = container.client.kazagumo.getPlayer(guildId);
	if (player?.voiceId) return player.voiceId;
	return getMusicGatewayClient().guilds.cache.get(guildId)?.members.me?.voice.channelId ?? null;
}
