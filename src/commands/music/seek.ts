import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';
import { parseTimeString } from '../../lib/music';

@ApplyOptions<Command.Options>({
	name: 'seek',
	description: 'Seek to a position in the current track (e.g. 1:30, 90s, 90)',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((o) => o.setName('time').setDescription('Position to seek to (e.g. 1:30, 90s, 90)').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player?.queue.current) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

		const raw = interaction.options.getString('time', true);
		const ms = parseTimeString(raw);
		if (ms === null) return interaction.reply({ content: 'Invalid time format. Use `1:30`, `90s`, or `90`.', ephemeral: true });

		await player.seek(ms);
		return interaction.reply(`⏩ Seeked to **${raw}**`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player?.queue.current) return message.reply('Nothing is playing right now.');

		const raw = await args.pick('string').catch(() => null);
		if (!raw) return message.reply('Please provide a time. Example: `%seek 1:30`');
		const ms = parseTimeString(raw);
		if (ms === null) return message.reply('Invalid time format. Use `1:30`, `90s`, or `90`.');

		await player.seek(ms);
		return message.reply(`⏩ Seeked to **${raw}**`);
	}
}
