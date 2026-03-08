import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'shuffle',
	description: 'Shuffle the upcoming tracks in the queue',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player || player.queue.size === 0) return interaction.reply({ content: 'There are no upcoming tracks to shuffle.', ephemeral: true });

		player.queue.shuffle();
		return interaction.reply(`🔀 Shuffled **${player.queue.size}** tracks.`);
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player || player.queue.size === 0) return message.reply('There are no upcoming tracks to shuffle.');

		player.queue.shuffle();
		return message.reply(`🔀 Shuffled **${player.queue.size}** tracks.`);
	}
}
