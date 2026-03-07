import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
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
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

		queue.delete();
		return interaction.reply('⏹️ Stopped playback and cleared the queue.');
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('Nothing is playing right now.');

		queue.delete();
		return message.reply('⏹️ Stopped playback and cleared the queue.');
	}
}
