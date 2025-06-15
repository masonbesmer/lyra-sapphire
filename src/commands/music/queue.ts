import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'queue',
	description: 'display the current music queue'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (interaction.member === null) return interaction.reply(`uh oh stinky a bomb will go off now`);
		const channel = (interaction.member as GuildMember).voice.channel;

		if (!channel) return interaction.reply("hey dumbass, you aren't in a voice channel.");

		const queue = player.nodes.get(interaction.guild!);
		if (!queue || !queue.node.isPlaying()) return interaction.reply('there is nothing playing right now.');

		const tracks = queue.tracks.toArray();
		if (tracks.length === 0) return interaction.reply('the queue is currently empty.');

		const description = tracks.map((t, i) => `${i + 1}. **${t.title ?? 'Unknown Title'}**`).join('\n');

		return interaction.reply(`Current Queue:\n${description}`);
	}
}
