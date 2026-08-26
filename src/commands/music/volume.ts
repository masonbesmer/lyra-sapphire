import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
import { broadcastEvent, broadcastQueueUpdate } from '../../lib/websocket';

@ApplyOptions<Command.Options>({
	name: 'volume',
	description: 'Set playback volume (1-100)',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((o) => o.setName('level').setDescription('Volume level (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "nothing's playing right now.", flags: MessageFlags.Ephemeral });

		const level = interaction.options.getInteger('level', true);
		await player.setVolume(level);
		broadcastEvent(interaction.guildId, 'volumeChange', { volume: level });
		broadcastQueueUpdate(interaction.guildId);
		return interaction.reply(`🔊 volume's at **${level}%** now.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("nothing's playing right now.");

		const level = await args.pick('integer').catch(() => null);
		if (!level || level < 1 || level > 100) return message.reply('give me a volume between 1 and 100. example: `%volume 50`');

		await player.setVolume(level);
		broadcastEvent(message.guildId, 'volumeChange', { volume: level });
		broadcastQueueUpdate(message.guildId);
		return message.reply(`🔊 volume's at **${level}%** now.`);
	}
}
