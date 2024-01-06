import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useQueue, useTimeline } from 'discord-player';

@ApplyOptions<Command.Options>({
	description: 'Pause the player'
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
		const timeline = useTimeline(interaction.guildId!);

		if (!queue) return interaction.reply({ content: "i'm not in a voice channel!", ephemeral: true });
		if (!queue.currentTrack) return interaction.reply({ content: 'hey goofball, the queue is empty', ephemeral: true });

		timeline?.paused ? timeline.resume() : timeline?.pause();
		return interaction.reply({ content: `player is now ${timeline?.paused ? 'paused' : 'resumed'}` });
	}
}
