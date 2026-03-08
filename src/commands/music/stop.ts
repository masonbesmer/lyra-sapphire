import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'stop',
	description: 'Stop playback, clear queue, and disconnect',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

		await player.destroy();
		return interaction.reply('⏹️ Stopped playback and cleared the queue.');
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('Nothing is playing right now.');

		await player.destroy();
		return message.reply('⏹️ Stopped playback and cleared the queue.');
	}
}
