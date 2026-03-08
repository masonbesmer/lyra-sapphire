import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'volume',
	description: 'Set playback volume (1-100)',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((o) => o.setName('level').setDescription('Volume level (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

		const level = interaction.options.getInteger('level', true);
		await player.setVolume(level);
		return interaction.reply(`🔊 Volume set to **${level}%**`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('Nothing is playing right now.');

		const level = await args.pick('integer').catch(() => null);
		if (!level || level < 1 || level > 100) return message.reply('Please provide a volume between 1 and 100. Example: `%volume 50`');

		await player.setVolume(level);
		return message.reply(`🔊 Volume set to **${level}%**`);
	}
}
