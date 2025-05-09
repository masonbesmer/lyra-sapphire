import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeiExtractor } from "discord-player-youtubei";
import { GatewayIntentBits, Partials } from 'discord.js';
import * as Utils from './lib/utils';

export class LyraClient extends SapphireClient {
	public override player: Player;
	public override utils: typeof Utils;
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
				GatewayIntentBits.GuildVoiceStates
			],
			partials: [Partials.Channel],
			loadMessageCommandListeners: true
		});
		this.utils = Utils;
		this.player = new Player(this, {
			skipFFmpeg: false
		});
		this.player.extractors.loadMulti(DefaultExtractors);
		this.player.extractors.register(YoutubeiExtractor, {});
	}
}

declare module 'discord.js' {
	interface Client {
		readonly player: Player;
		readonly utils: typeof Utils;
	}
}