import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';
import { repeatModeLabel } from '../../lib/music';

const MODES = ['off', 'track', 'queue'] as const;
type LoopMode = (typeof MODES)[number];

@ApplyOptions<Command.Options>({
	name: 'loop',
	description: 'Set the repeat mode (off, track, queue)',
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
						.addChoices({ name: 'Off', value: 'off' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' })
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const modeStr = interaction.options.getString('mode', true).toLowerCase() as LoopMode;
		if (!MODES.includes(modeStr)) return interaction.reply({ content: 'Invalid mode. Use: off, track, queue', ephemeral: true });

		player.setLoop(modeStr);
		return interaction.reply(`🔁 Loop mode set to **${repeatModeLabel(modeStr)}**`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('There is no active queue.');

		const modeStr = (await args.pick('string').catch(() => null))?.toLowerCase() as LoopMode | null;
		if (!modeStr) return message.reply('Please provide a mode: off, track, queue. Example: `%loop track`');
		if (!MODES.includes(modeStr)) return message.reply('Invalid mode. Use: off, track, queue');

		player.setLoop(modeStr);
		return message.reply(`🔁 Loop mode set to **${repeatModeLabel(modeStr)}**`);
	}
}
