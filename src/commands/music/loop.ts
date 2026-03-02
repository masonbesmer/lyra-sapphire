import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { QueueRepeatMode, useMainPlayer } from 'discord-player';
import { Message } from 'discord.js';
import { repeatModeLabel } from '../../lib/music';

const MODES: Record<string, QueueRepeatMode> = {
	off: QueueRepeatMode.OFF,
	track: QueueRepeatMode.TRACK,
	queue: QueueRepeatMode.QUEUE,
	autoplay: QueueRepeatMode.AUTOPLAY
};

@ApplyOptions<Command.Options>({
	name: 'loop',
	description: 'Set the repeat mode (off, track, queue, autoplay)',
	preconditions: ['InVoiceWithBot']
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const modeStr = interaction.options.getString('mode', true).toLowerCase();
		const mode = MODES[modeStr];
		if (mode === undefined) return interaction.reply({ content: 'Invalid mode. Use: off, track, queue, autoplay', ephemeral: true });

		queue.setRepeatMode(mode);
		return interaction.reply(`🔁 Loop mode set to **${repeatModeLabel(mode)}**`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		const modeStr = (await args.pick('string').catch(() => null))?.toLowerCase();
		if (!modeStr) return message.reply('Please provide a mode: off, track, queue, autoplay. Example: `%loop track`');
		const mode = MODES[modeStr];
		if (mode === undefined) return message.reply('Invalid mode. Use: off, track, queue, autoplay');

		queue.setRepeatMode(mode);
		return message.reply(`🔁 Loop mode set to **${repeatModeLabel(mode)}**`);
	}
}
