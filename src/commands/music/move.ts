import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import type { KazagumoTrack } from 'kazagumo';
import { MessageFlags, Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'move',
	description: 'Move a track within the queue',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((o) => o.setName('from').setDescription('Current position (1 = next)').setRequired(true).setMinValue(1))
				.addIntegerOption((o) => o.setName('to').setDescription('Target position').setRequired(true).setMinValue(1))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "there's no active queue.", flags: MessageFlags.Ephemeral });

		const from = interaction.options.getInteger('from', true);
		const to = interaction.options.getInteger('to', true);
		const track = player.queue[from - 1] as KazagumoTrack | undefined;
		if (!track) return interaction.reply({ content: `nothing at position ${from}.`, flags: MessageFlags.Ephemeral });

		// Remove from current position, insert at new position
		player.queue.remove(from - 1);
		player.queue.splice(to - 1, 0, track);
		return interaction.reply(`↕️ moved **${track.title}** to position ${to}.`);
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("there's no active queue.");

		const from = await args.pick('integer').catch(() => null);
		const to = await args.pick('integer').catch(() => null);
		if (!from || !to) return message.reply('give me a from and to position. example: `%move 3 1`');
		const track = player.queue[from - 1] as KazagumoTrack | undefined;
		if (!track) return message.reply(`nothing at position ${from}.`);

		player.queue.remove(from - 1);
		player.queue.splice(to - 1, 0, track);
		return message.reply(`↕️ moved **${track.title}** to position ${to}.`);
	}
}
