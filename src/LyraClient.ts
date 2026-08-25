import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Kazagumo, Plugins } from 'kazagumo';
import { Connectors, Constants } from 'shoukaku';
import type { NodeOption } from 'shoukaku';
import type { ShoukakuOptions } from 'shoukaku';
import { GatewayIntentBits, OAuth2Scopes, Partials } from 'discord.js';
import * as Utils from './lib/utils';

function getLavalinkNodes(): NodeOption[] {
	return [
		{
			name: process.env.LAVALINK_NODE_NAME ?? 'main',
			url: process.env.LAVALINK_HOST ?? 'localhost:2333',
			auth: process.env.LAVALINK_PASSWORD ?? 'youshallnotpass',
			secure: process.env.LAVALINK_SECURE === 'true'
		}
	];
}

function parseNonNegativeNumberEnv(name: string): number | undefined {
	const rawValue = process.env[name];
	if (!rawValue) return undefined;

	const parsedValue = Number(rawValue);
	if (!Number.isFinite(parsedValue) || parsedValue < 0) return undefined;

	return parsedValue;
}

function getShoukakuOptions(): ShoukakuOptions {
	// Our env vars are documented/configured in milliseconds, but Shoukaku's
	// reconnectInterval/restTimeout are in seconds internally (it does `* 1000` itself).
	// Passing ms straight through previously turned a 3000ms interval into a 3000s (50min) wait.
	const reconnectTries = parseNonNegativeNumberEnv('LAVALINK_RECONNECT_TRIES');
	const reconnectIntervalMs = parseNonNegativeNumberEnv('LAVALINK_RECONNECT_INTERVAL');
	const restTimeoutMs = parseNonNegativeNumberEnv('LAVALINK_REST_TIMEOUT');

	const options: ShoukakuOptions = {};
	if (reconnectTries !== undefined) options.reconnectTries = reconnectTries;
	if (reconnectIntervalMs !== undefined) options.reconnectInterval = reconnectIntervalMs / 1000;
	if (restTimeoutMs !== undefined) options.restTimeout = restTimeoutMs / 1000;

	return options;
}

const NODE_HEALTH_CHECK_INTERVAL_MS = 30_000;

export class LyraClient extends SapphireClient {
	public override kazagumo: Kazagumo;
	public override utils: typeof Utils;
	public override chaosEnabled = false;
	public constructor() {
		super({
			defaultPrefix: '%',
			regexPrefix: /^(hey +)?lyra[,! ]/i,
			caseInsensitiveCommands: true,
			logger: {
				level: LogLevel.Debug
			},
			shards: 'auto',
			intents: [
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.Guilds,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.GuildVoiceStates,
				GatewayIntentBits.GuildPresences
			],
			partials: [
				Partials.Channel,
				Partials.Message,
				Partials.Reaction,
				Partials.User,
				Partials.SoundboardSound,
				Partials.ThreadMember,
				Partials.GuildScheduledEvent
			],
			loadMessageCommandListeners: true,
			api: {
				auth:
					process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET
						? {
								id: process.env.DISCORD_CLIENT_ID,
								secret: process.env.DISCORD_CLIENT_SECRET,
								redirect: process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:4000/oauth/callback',
								scopes: [OAuth2Scopes.Identify, OAuth2Scopes.Guilds],
								cookie: 'lyra_session'
							}
						: undefined,
				listenOptions: { port: parseInt(process.env.API_PORT ?? '4000') },
				origin: process.env.DASHBOARD_ORIGIN ?? '*'
			}
		});
		this.utils = Utils;

		this.kazagumo = new Kazagumo(
			{
				defaultSearchEngine: 'youtube',
				send: (guildId, payload) => {
					const guild = this.guilds.cache.get(guildId);
					guild?.shard.send(payload);
				},
				plugins: [new Plugins.PlayerMoved(this)]
			},
			new Connectors.DiscordJS(this),
			getLavalinkNodes(),
			getShoukakuOptions()
		);

		const shoukaku = this.kazagumo.shoukaku;

		// ── Kazagumo / Shoukaku event listeners ────────────────────────────────

		this.kazagumo.on('playerCreate', (player) => {
			this.logger.info(`[Kazagumo] Player created for guild: ${player.guildId}`);
		});

		this.kazagumo.on('playerDestroy', (player) => {
			this.logger.info(`[Kazagumo] Player destroyed for guild: ${player.guildId}`);
		});

		this.kazagumo.on('playerException', (player, data) => {
			this.logger.error(`[Kazagumo] Player exception in guild ${player.guildId}: ${data.exception?.message ?? String(data)}`);
		});

		this.kazagumo.on('playerStuck', (player, data) => {
			this.logger.warn(`[Kazagumo] Player stuck in guild ${player.guildId}: thresholdMs=${data.thresholdMs}`);
		});

		this.kazagumo.on('playerClosed', (player, data) => {
			this.logger.warn(`[Kazagumo] Player WS closed in guild ${player.guildId}: code=${data.code} reason=${data.reason}`);
		});

		this.kazagumo.on('playerResolveError', (player, track, message) => {
			this.logger.error(`[Kazagumo] Track resolve error in guild ${player.guildId} for "${track.title}": ${message}`);
		});

		this.kazagumo.on('playerUpdate', (player, data) => {
			this.logger.debug(`[Kazagumo] Player update in guild ${player.guildId}: position=${data.state?.position}`);
		});

		this.kazagumo.on('playerMoved', (player, state, channels) => {
			this.logger.info(`[Kazagumo] Player moved in guild ${player.guildId}: ${state} (${channels.oldChannelId} → ${channels.newChannelId})`);

			// A player outliving its voice connection is worse than no player: Lavalink keeps
			// decoding into a dead connection, so position advances and the dashboard shows
			// progress while nobody hears anything.
			if (state === 'LEFT') {
				// Being disconnected ends the session, same as /disconnect.
				player.destroy().catch((error) => {
					this.logger.error(`[Kazagumo] Failed to destroy player after disconnect in ${player.guildId}: ${String(error)}`);
				});
			} else if (state === 'MOVED' && channels.newChannelId) {
				// Dragged to another channel — follow it rather than stranding the player.
				player.setVoiceChannel(channels.newChannelId);
			}
		});

		shoukaku.on('error', (name, error) => {
			this.logger.error(`[Shoukaku] Node error on ${name}: ${error.message}`);
		});

		shoukaku.on('close', (name, code, reason) => {
			this.logger.warn(`[Shoukaku] Node socket closed on ${name}: code=${code} reason=${reason || 'unknown'}`);
		});

		shoukaku.on('disconnect', (name, count) => {
			this.logger.warn(`[Shoukaku] Node disconnected on ${name}; reconnect attempts so far: ${count}`);
		});

		shoukaku.on('reconnecting', (name, reconnectsLeft, reconnectInterval) => {
			this.logger.warn(`[Shoukaku] Reconnecting node ${name}; tries left=${reconnectsLeft}, intervalMs=${reconnectInterval}`);
		});

		shoukaku.on('ready', (name, lavalinkResume, libraryResume) => {
			this.logger.info(`[Shoukaku] Node ready: ${name} (lavalinkResume=${String(lavalinkResume)}, libraryResume=${String(libraryResume)})`);
		});

		// Log Shoukaku node events after ready
		this.once('clientReady', () => {
			for (const [, node] of this.kazagumo.shoukaku.nodes) {
				this.logger.info(`[Shoukaku] Connected to Lavalink node: ${node.name} (${node.state})`);
			}

			// Shoukaku's own reconnect loop gives up after reconnectTries and never retries again on
			// its own (a node stuck DISCONNECTED stays that way until the process restarts). Poll for
			// that and kick off a fresh connect() so a Lavalink blip doesn't need a manual bot restart.
			setInterval(() => {
				for (const [, node] of shoukaku.nodes) {
					if (node.state !== Constants.State.DISCONNECTED) continue;
					this.logger.warn(`[Shoukaku] Node ${node.name} is disconnected; attempting self-heal reconnect`);
					node.connect().catch((error) => {
						this.logger.error(`[Shoukaku] Self-heal reconnect failed for node ${node.name}: ${String(error)}`);
					});
				}
			}, NODE_HEALTH_CHECK_INTERVAL_MS).unref();
		});

		// Log library versions
		try {
			const shoukakuVersion = require('shoukaku/package.json').version;
			const kazagumoVersion = require('kazagumo/package.json').version;
			this.logger.info(`Shoukaku version: ${shoukakuVersion} | Kazagumo version: ${kazagumoVersion}`);
		} catch {
			this.logger.warn('Could not determine Shoukaku/Kazagumo version');
		}
	}
}

declare module 'discord.js' {
	interface Client {
		readonly kazagumo: Kazagumo;
		readonly utils: typeof Utils;
		chaosEnabled: boolean;
	}
}
