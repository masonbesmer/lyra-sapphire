import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'skipto',
	description: 'skip to a specific song in the queue',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) => option.setName('track').setDescription('The position of the track in the queue').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (interaction.member === null) return interaction.reply(`uh oh stinky a bomb will go off now`);

		const queue = player.nodes.get(interaction.guild!);
		if (!queue || !queue.node.isPlaying()) return interaction.reply('there is nothing playing right now.');

		const trackIndex = interaction.options.getInteger('track', true) - 1;
		const track = queue.tracks.at(trackIndex);
		if (!track) return interaction.reply('invalid track number.');

		queue.node.skipTo(track);
		return interaction.reply(`skipped to track #${trackIndex + 1}.`);
	}
}
