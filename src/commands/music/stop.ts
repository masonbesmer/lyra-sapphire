import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';

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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "nothing's playing right now.", flags: MessageFlags.Ephemeral });

		await player.destroy();
		return interaction.reply("⏹️ stopped and cleared the queue. we're done here.");
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("nothing's playing right now.");

		await player.destroy();
		return message.reply("⏹️ stopped and cleared the queue. we're done here.");
	}
}
