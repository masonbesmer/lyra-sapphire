import { ApplyOptions } from '@sapphire/decorators';
import { Command, Args } from '@sapphire/framework';
import type { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	description: 'Toggle chaos mode',
	preconditions: ['OwnerOnly']
})
export class ChaosCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable chaos mode').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const enabled = interaction.options.getBoolean('enabled', true);
		this.container.client.chaosEnabled = enabled;
		return interaction.reply({ content: `Chaos mode is now ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
	}

	public override async messageRun(message: Message, args: Args) {
		const enabled = await args.pick('boolean');
		this.container.client.chaosEnabled = enabled;
		return message.reply(`Chaos mode is now ${enabled ? 'enabled' : 'disabled'}.`);
	}
}
