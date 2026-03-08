import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';
import { buildNowPlayingEmbed } from '../../lib/music';

@ApplyOptions<Command.Options>({
	name: 'nowplaying',
	description: 'Show what is currently playing',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player?.queue.current) return interaction.reply({ content: 'Nothing is currently playing.', ephemeral: true });
		return interaction.reply({ embeds: [buildNowPlayingEmbed(player)] });
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player?.queue.current) return message.reply('Nothing is currently playing.');
		return message.reply({ embeds: [buildNowPlayingEmbed(player)] });
	}
}
