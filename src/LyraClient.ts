import { LogLevel, SapphireClient } from '@sapphire/framework';
import { Player } from 'discord-player';
import { GatewayIntentBits } from 'discord.js';
import * as Utils from './lib/utils';

export class LyraClient extends SapphireClient {
	public override player: Player;
	public override utils: typeof Utils;
	public constructor() {
		super({
			defaultPrefix: '%',
			caseInsensitiveCommands: true,
			logger: {
				level: LogLevel.Debug
			},
			intents: [
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.Guilds,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.GuildVoiceStates
			],
			loadMessageCommandListeners: true
		});
		this.utils = Utils;
		this.player = new Player(this);
	}
}

declare module 'discord.js' {
	interface Client {
		readonly player: Player;
		readonly utils: typeof Utils;
	}
}
