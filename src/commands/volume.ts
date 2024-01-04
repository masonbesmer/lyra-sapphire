import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useQueue, useTimeline } from 'discord-player';

@ApplyOptions<Command.Options>({
	description: 'Changes the volume of the player',
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option.setName('volume').setDescription('The volume to set').setMinValue(0).setMaxValue(50000)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const queue = useQueue(interaction.guild!.id);
		const timeline = useTimeline(interaction.guild!.id)!;
		const volume = interaction.options.getInteger('volume');

		if (!queue) return interaction.reply({ content: `fuck | I am not in a voice channel`, ephemeral: true });
		if (!queue.currentTrack)
			return interaction.reply({
				content: `fuck | There is no track currently playing`,
				ephemeral: true
			});

		if (!volume) return interaction.reply({ content: `🔊 | **Current** volume is **${timeline.volume}%**` });

		timeline.setVolume(volume!);
		return interaction.reply({
			content: `POGGERS | I **changed** the volume to: **${timeline.volume}%**`
		});
	}
}
