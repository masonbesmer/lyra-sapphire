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
let musicToken: string | null = null;
let ready = false;

/**
 * The second bot's token, or null when there isn't one.
 *
 * Empty is unset, not a value. Compose writes `DISCORD_MUSIC_TOKEN=${DISCORD_MUSIC_TOKEN:-}`,
 * so an undeclared variable still reaches the container as an empty string — and `??` treats
 * that as an answer and never falls through. That silently ran music on the main client in
 * prod, where the secret is still under the old name, which is the whole failure this split
 * exists to prevent. Use `||` here, always.
 *
 * DISCORD_LISTENER_TOKEN is that old name, from when this client did the listening.
 */
function readMusicToken(): string | null {
	return process.env.DISCORD_MUSIC_TOKEN || process.env.DISCORD_LISTENER_TOKEN || null;
}

/** Builds the music client, if a token is configured. Must run before Kazagumo is constructed. */
export function createMusicClient(): Client | null {
	musicToken = readMusicToken();
	if (!musicToken) {
		container.logger.info('[voice/music] neither DISCORD_MUSIC_TOKEN nor DISCORD_LISTENER_TOKEN is set; music shares the main bot voice state.');
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
	if (!musicClient || !musicToken) return;

	try {
		// The token resolved at creation, not a second read of the environment: the two must
		// not be able to disagree about which bot this is.
		await musicClient.login(musicToken);
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
