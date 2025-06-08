import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'skip',
	description: 'skip the current song'
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

		queue.node.skip();
		return interaction.reply('skipped the current song.');
	}
}
