import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'move',
	description: 'Move a track within the queue',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((o) => o.setName('from').setDescription('Current position (1 = next)').setRequired(true).setMinValue(1))
				.addIntegerOption((o) => o.setName('to').setDescription('Target position').setRequired(true).setMinValue(1))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const from = interaction.options.getInteger('from', true);
		const to = interaction.options.getInteger('to', true);
		const track = queue.tracks.at(from - 1);
		if (!track) return interaction.reply({ content: `No track at position ${from}.`, ephemeral: true });

		queue.moveTrack(track, to - 1);
		return interaction.reply(`↕️ Moved **${track.title}** to position ${to}.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		const from = await args.pick('integer').catch(() => null);
		const to = await args.pick('integer').catch(() => null);
		if (!from || !to) return message.reply('Please provide from and to positions. Example: `%move 3 1`');
		const track = queue.tracks.at(from - 1);
		if (!track) return message.reply(`No track at position ${from}.`);

		queue.moveTrack(track, to - 1);
		return message.reply(`↕️ Moved **${track.title}** to position ${to}.`);
	}
}
