import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useQueue } from 'discord-player';

@ApplyOptions<Command.Options>({
	description: 'Skip current song'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const queue = useQueue(interaction.guildId!);

		if (!queue) return interaction.reply({ content: "i'm not in a voice channel!", ephemeral: true });
		if (!queue.currentTrack) return interaction.reply({ content: 'silly, the queue is empty!', ephemeral: true });
		queue.node.skip();
		return interaction.reply(`okay, skipping!`);
	}
}
