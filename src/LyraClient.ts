import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Kazagumo, Plugins } from 'kazagumo';
import { Connectors } from 'shoukaku';
import type { NodeOption } from 'shoukaku';
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
			getLavalinkNodes()
		);

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
		});

		// Log Shoukaku node events after ready
		this.once('ready', () => {
			for (const [, node] of this.kazagumo.shoukaku.nodes) {
				this.logger.info(`[Shoukaku] Connected to Lavalink node: ${node.name} (${node.state})`);
			}
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
