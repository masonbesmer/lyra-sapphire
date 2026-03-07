import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import { GatewayIntentBits, OAuth2Scopes, Partials } from 'discord.js';
import * as Utils from './lib/utils';

export class LyraClient extends SapphireClient {
	public override player: Player;
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
		this.player = new Player(this, {
			skipFFmpeg: false,
			connectionTimeout: 120_000
		});

		// Log FFmpeg availability
		try {
			const ffmpeg = require('@ffmpeg-installer/ffmpeg');
			this.logger.info(`FFmpeg path: ${ffmpeg.path}`);
		} catch (error) {
			this.logger.error('FFmpeg not found:', error);
		}

		// Try to register YoutubeiExtractor with comprehensive error handling
		try {
			this.player.extractors.register(YoutubeiExtractor, {});
			this.logger.info('YoutubeiExtractor registered successfully');
		} catch (error) {
			this.logger.error('Failed to register YoutubeiExtractor:', error);
			this.logger.error('Error details:', error);
		}

		// Load default extractors after YoutubeiExtractor for other sources
		try {
			this.player.extractors.loadMulti(DefaultExtractors);
			this.logger.info('Default extractors loaded');
		} catch (error) {
			this.logger.error('Failed to load default extractors:', error);
		}

		// Log available extractors
		this.logger.info(`Total extractors loaded: ${this.player.extractors.store.size}`);
		for (const [name, extractor] of this.player.extractors.store) {
			this.logger.info(`- ${name}: ${extractor.constructor.name}`);
		}

		// Handle player errors gracefully
		this.player.events.on('playerError', (queue, error) => {
			this.logger.error(`Player error occurred in ${queue.guild.name}:`, error);
			this.logger.error('Error stack:', error.stack);
		});

		// Handle extractor errors
		this.player.events.on('error', (queue, error) => {
			if (error && typeof error === 'object' && 'code' in error && error.code === 'ABORT_ERR') {
				const voiceStatus = queue.dispatcher?.voiceConnection?.state?.status ?? 'unknown';
				this.logger.warn(
					`Player connection timed out in ${queue.guild.name} — voice state: ${voiceStatus}. ` +
						`The voice WS dropped during handshake and did not recover within connectionTimeout. ` +
						`Error: ${String(error)}`
				);
				return;
			}

			this.logger.error(`Player extractor error in ${queue.guild.name}:`, error);
			this.logger.error('Error stack:', error.stack);
		});

		// Add more debugging events
		this.player.events.on('audioTrackAdd', (_queue, track) => {
			this.logger.debug(`Track added to queue: ${track.title}`);
		});

		this.player.events.on('playerStart', (queue, track) => {
			this.logger.debug(`Started playing: ${track.title}`);
			this.logger.debug(`Queue size: ${queue.tracks.size}, Current track duration: ${track.durationMS}ms`);
		});

		this.player.events.on('playerFinish', (queue, track) => {
			this.logger.debug(`Track finished: ${track.title} in guild ${queue.guild.name}`);
			this.logger.debug(`Playback duration: ${queue.node.streamTime}ms`);
		});

		this.player.events.on('audioPlayerError', (queue, error) => {
			this.logger.error(`Audio player error in ${queue.guild.name}:`, error);
			if (error.resource) {
				this.logger.error(`Resource metadata:`, error.resource.metadata);
			}
		});

		this.player.events.on('playerPause', (queue) => {
			this.logger.debug(`Player paused in guild: ${queue.guild.name}`);
		});

		this.player.events.on('playerResume', (queue) => {
			this.logger.debug(`Player resumed in guild: ${queue.guild.name}`);
		});

		this.player.events.on('playerSkip', (queue, track) => {
			this.logger.debug(`Player skipped track: ${track.title} in guild: ${queue.guild.name}`);
		});

		this.player.events.on('connection', (queue) => {
			this.logger.info(`Voice connection established for guild: ${queue.guild.name}`);
		});

		this.player.events.on('disconnect', (queue) => {
			this.logger.info(`Disconnected from voice channel in guild: ${queue.guild.name}`);
		});

		this.player.events.on('emptyQueue', (queue) => {
			this.logger.debug(`Queue is empty in guild: ${queue.guild.name}`);
		});

		this.player.events.on('emptyChannel', (queue) => {
			this.logger.debug(`Voice channel is empty in guild: ${queue.guild.name}`);
		});

		this.player.events.on('debug', (_queue, message) => {
			this.logger.debug(`Player debug: ${message}`);
		});

		// Log discord-player version
		try {
			const dpVersion = require('discord-player/package.json').version;
			this.logger.info(`discord-player version: ${dpVersion}`);
		} catch {
			this.logger.warn('Could not determine discord-player version');
		}
	}
}

declare module 'discord.js' {
	interface Client {
		readonly player: Player;
		readonly utils: typeof Utils;
		chaosEnabled: boolean;
	}
}
