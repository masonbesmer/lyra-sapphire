import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
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
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue?.currentTrack) return interaction.reply({ content: 'Nothing is currently playing.', ephemeral: true });
		return interaction.reply({ embeds: [buildNowPlayingEmbed(queue)] });
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue?.currentTrack) return message.reply('Nothing is currently playing.');
		return message.reply({ embeds: [buildNowPlayingEmbed(queue)] });
	}
}
