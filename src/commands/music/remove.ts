import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'remove',
	description: 'Remove a track from the queue by position',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((o) => o.setName('position').setDescription('Position in the queue (1 = next)').setRequired(true).setMinValue(1))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const pos = interaction.options.getInteger('position', true);
		const track = queue.tracks.at(pos - 1);
		if (!track) return interaction.reply({ content: `No track at position ${pos}.`, ephemeral: true });

		queue.removeTrack(track);
		return interaction.reply(`🗑️ Removed **${track.title}** from the queue.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		const pos = await args.pick('integer').catch(() => null);
		if (!pos) return message.reply('Please provide a position. Example: `%remove 2`');
		const track = queue.tracks.at(pos - 1);
		if (!track) return message.reply(`No track at position ${pos}.`);

		queue.removeTrack(track);
		return message.reply(`🗑️ Removed **${track.title}** from the queue.`);
	}
}
