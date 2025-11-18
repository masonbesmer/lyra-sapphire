import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import { GatewayIntentBits, Partials } from 'discord.js';
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
			loadMessageCommandListeners: true
		});
		this.utils = Utils;
		this.player = new Player(this, {
			skipFFmpeg: false
		});

		// Log FFmpeg availability
		try {
			const ffmpeg = require('@ffmpeg-installer/ffmpeg');
			this.logger.info(`FFmpeg path: ${ffmpeg.path}`);
		} catch (error) {
			this.logger.error('FFmpeg not found:', error);
		}

		// Load default extractors first
		this.player.extractors.loadMulti(DefaultExtractors);

		// Log available extractors
		this.logger.info(`Loaded extractors: ${this.player.extractors.store.size}`);
		for (const [name, extractor] of this.player.extractors.store) {
			this.logger.info(`- ${name}: ${extractor.constructor.name}`);
		}

		// Try to register YoutubeiExtractor with comprehensive error handling
		try {
			this.player.extractors.register(YoutubeiExtractor, {});
			this.logger.info('YoutubeiExtractor registered successfully');
		} catch (error) {
			this.logger.warn('Failed to register YoutubeiExtractor:', error);
		}

		// Handle player errors gracefully
		this.player.events.on('playerError', (_queue, error) => {
			this.logger.error('Player error occurred:', error);
			// Don't crash the bot on player errors
		});

		// Handle extractor errors
		this.player.events.on('error', (_queue, error) => {
			this.logger.error('Player extractor error:', error);
		});

		// Add more debugging events
		this.player.events.on('audioTrackAdd', (_queue, track) => {
			this.logger.debug(`Track added to queue: ${track.title}`);
		});

		this.player.events.on('playerStart', (_queue, track) => {
			this.logger.debug(`Started playing: ${track.title}`);
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

		this.player.events.on('debug', (_queue, message) => {
			this.logger.debug(`Player debug: ${message}`);
		});
	}
}

declare module 'discord.js' {
	interface Client {
		readonly player: Player;
		readonly utils: typeof Utils;
		chaosEnabled: boolean;
	}
}
