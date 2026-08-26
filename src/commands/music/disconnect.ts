import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'disconnect',
	description: 'Disconnect the bot from voice',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (player) {
			await player.destroy();
		} else {
			const me = interaction.guild.members.me;
			if (me?.voice.channel) me.voice.disconnect();
		}
		return interaction.reply("👋 alright, I'm out.");
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guild || !message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (player) {
			await player.destroy();
		} else {
			const me = message.guild.members.me;
			if (me?.voice.channel) me.voice.disconnect();
		}
		return message.reply("👋 alright, I'm out.");
	}
}
