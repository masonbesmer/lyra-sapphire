import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'skipto',
	description: 'skip to a specific song in the queue',
	preconditions: ['InVoiceWithBot', 'DJOnly']
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });

		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player?.playing) return interaction.reply('there is nothing playing right now.');

		const trackIndex = interaction.options.getInteger('track', true) - 1;
		if (trackIndex < 0 || trackIndex >= player.queue.size) return interaction.reply('invalid track number.');

		// Remove all tracks before target position, then skip
		player.queue.splice(0, trackIndex);
		player.skip();
		return interaction.reply(`skipped to track #${trackIndex + 1}.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player?.playing) return message.reply('there is nothing playing right now.');

		const trackNumber = await args.pick('integer').catch(() => null);
		if (!trackNumber) return message.reply('Please provide a track number. Example: `%skipto 3`');
		if (trackNumber < 1 || trackNumber > player.queue.size) return message.reply('invalid track number.');

		player.queue.splice(0, trackNumber - 1);
		player.skip();
		return message.reply(`skipped to track #${trackNumber}.`);
	}
}
