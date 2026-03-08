import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import type { KazagumoTrack } from 'kazagumo';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'remove',
	description: 'Remove a track from the queue by position',
	preconditions: ['InVoiceWithBot', 'DJOnly']
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
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const pos = interaction.options.getInteger('position', true);
		const track = player.queue[pos - 1] as KazagumoTrack | undefined;
		if (!track) return interaction.reply({ content: `No track at position ${pos}.`, ephemeral: true });

		player.queue.remove(pos - 1);
		return interaction.reply(`🗑️ Removed **${track.title}** from the queue.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('There is no active queue.');

		const pos = await args.pick('integer').catch(() => null);
		if (!pos) return message.reply('Please provide a position. Example: `%remove 2`');
		const track = player.queue[pos - 1] as KazagumoTrack | undefined;
		if (!track) return message.reply(`No track at position ${pos}.`);

		player.queue.remove(pos - 1);
		return message.reply(`🗑️ Removed **${track.title}** from the queue.`);
	}
}
