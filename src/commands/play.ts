import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'play',
	description: 'Play'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) => {
					return option.setName('query').setDescription('The song to play').setRequired(true).setAutocomplete(true);
				})
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (interaction.member === null) return interaction.reply(`uh oh stinky a bomb will go off now`);
		const channel = (interaction.member as GuildMember).voice.channel; // weird required cast?

		if (!channel) return interaction.reply("hey dumbass, you aren't in a voice channel."); // check for VC
		const query = interaction.options.getString('query', true);

		// defer interaction to avoid timeout
		await interaction.deferReply();

		try {
			const { track } = await player.play(channel, query, {
				nodeOptions: {
					// for the guild node (queue)
					metadata: interaction, // access later using queue.metadata
					volume: 10,
				}
			});

			return interaction.followUp(`added **${track.title}** to the queue <3`);
		} catch (e) {
			// return error?
			return interaction.followUp(`something went wrong: ${e}`);
		}
	}
}
