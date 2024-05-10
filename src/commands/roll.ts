import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	// name: 'roll',
	description: 'Roll an n-sided die m times and return the results.'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option //
						.setName('sides')
						.setDescription('The number of sides on the dice')
						.setRequired(true)
				)
				.addIntegerOption((option) =>
					option //
						.setName('rolls')
						.setDescription('The number of times to roll the dice')
						.setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		// This command takes in 2 arguments, both of which are numbers. "sides" is the number of sides on the dice,
		// and "rolls" is the number of times to roll the dice. "rolls" is optional and defaults to 1. The command will reply with the results of the rolls, including a sum, if applicable.
		const sides = interaction.options.getInteger('sides', true);
		const rolls = interaction.options.getInteger('rolls') ?? 1;

		if (sides < 2) {
			return interaction.reply('The number of sides on the dice must be at least 2.');
		}

		if (rolls < 1) {
			return interaction.reply('The number of rolls must be at least 1.');
		}

		const results = new Array(rolls).fill(0).map(() => Math.floor(Math.random() * sides) + 1);
		const sum = results.reduce((acc, curr) => acc + curr, 0);

		return interaction.reply(`Results: ${results.join(', ')}${rolls > 1 ? ` (Sum: ${sum})` : ''}`);
	}
}
