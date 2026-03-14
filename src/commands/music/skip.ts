import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'skip',
	description: 'skip the current song or skip to a specific song in the queue',
	preconditions: ['InVoiceWithBot', 'DJOnly']
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });

		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player?.playing) return interaction.reply('there is nothing playing right now.');

		const trackNumber = interaction.options.getInteger('track', false);

		if (trackNumber !== null) {
			if (trackNumber < 1 || trackNumber > player.queue.size) return interaction.reply('invalid track number.');
			// Remove all tracks before the target position, then skip
			player.queue.splice(0, trackNumber - 1);
			player.skip();
			return interaction.reply(`skipped to track #${trackNumber}.`);
		} else {
			player.skip();
			return interaction.reply('skipped the current song.');
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player?.playing) return message.reply('there is nothing playing right now.');

		const trackNumber = await args.pick('integer').catch(() => null);
		if (trackNumber !== null) {
			if (trackNumber < 1 || trackNumber > player.queue.size) return message.reply('invalid track number.');
			player.queue.splice(0, trackNumber - 1);
			player.skip();
			return message.reply(`skipped to track #${trackNumber}.`);
		} else {
			player.skip();
			return message.reply('skipped the current song.');
		}
	}
}
