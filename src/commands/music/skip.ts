import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'skip',
	description: 'skip the current song or skip to a specific song in the queue',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option.setName('track').setDescription('The position of the track in the queue to skip to').setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (interaction.member === null) return interaction.reply(`uh oh stinky a bomb will go off now`);

		const queue = player.nodes.get(interaction.guild!);
		if (!queue || !queue.node.isPlaying()) return interaction.reply('there is nothing playing right now.');

		const trackNumber = interaction.options.getInteger('track', false);

		if (trackNumber !== null) {
			const trackIndex = trackNumber - 1;
			const track = queue.tracks.at(trackIndex);
			if (!track) return interaction.reply('invalid track number.');

			queue.node.skipTo(track);
			return interaction.reply(`skipped to track #${trackNumber}.`);
		} else {
			queue.node.skip();
			return interaction.reply('skipped the current song.');
		}
	}
}
