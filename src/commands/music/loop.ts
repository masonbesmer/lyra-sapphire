import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
import { repeatModeLabel, applyLoopMode, type LoopMode as KazagumoLoopMode } from '../../lib/music';
import { broadcastEvent, broadcastQueueUpdate } from '../../lib/websocket';

const MODES = ['off', 'track', 'queue', 'autoplay'] as const;
type LoopMode = (typeof MODES)[number];

/** off is the user-facing spelling; Kazagumo's native value is 'none'. */
function toKazagumoMode(mode: LoopMode): KazagumoLoopMode {
	return mode === 'off' ? 'none' : mode;
}

@ApplyOptions<Command.Options>({
	name: 'loop',
	description: 'Set the repeat mode (off, track, queue, autoplay)',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((o) =>
					o
						.setName('mode')
						.setDescription('Repeat mode')
						.setRequired(true)
						.addChoices(
							{ name: 'Off', value: 'off' },
							{ name: 'Track', value: 'track' },
							{ name: 'Queue', value: 'queue' },
							{ name: 'Autoplay', value: 'autoplay' }
						)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "there's no active queue.", flags: MessageFlags.Ephemeral });

		const modeStr = interaction.options.getString('mode', true).toLowerCase() as LoopMode;
		if (!MODES.includes(modeStr)) {
			return interaction.reply({ content: "that's not a mode I know. pick one: off, track, queue, autoplay", flags: MessageFlags.Ephemeral });
		}

		const kazagumoMode = toKazagumoMode(modeStr);
		applyLoopMode(player, kazagumoMode);
		broadcastEvent(interaction.guildId, 'loopChange', { mode: kazagumoMode });
		broadcastQueueUpdate(interaction.guildId);
		return interaction.reply(`🔁 loop mode's **${repeatModeLabel(kazagumoMode)}** now.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("there's no active queue.");

		const modeStr = (await args.pick('string').catch(() => null))?.toLowerCase() as LoopMode | null;
		if (!modeStr) return message.reply('give me a mode: off, track, queue, autoplay. example: `%loop track`');
		if (!MODES.includes(modeStr)) return message.reply("that's not a mode I know. pick one: off, track, queue, autoplay");

		const kazagumoMode = toKazagumoMode(modeStr);
		applyLoopMode(player, kazagumoMode);
		broadcastEvent(message.guildId, 'loopChange', { mode: kazagumoMode });
		broadcastQueueUpdate(message.guildId);
		return message.reply(`🔁 loop mode's **${repeatModeLabel(kazagumoMode)}** now.`);
	}
}
