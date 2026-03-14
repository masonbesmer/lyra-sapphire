import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Message } from 'discord.js';
import { buildPlayerRows } from '../../lib/playerButtons';
import { getCachedMessage } from '../../lib/playerMessages';

@ApplyOptions<Command.Options>({
	name: 'pause',
	description: 'Toggle pause/resume',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

		if (player.paused) {
			player.pause(false);
			const msg = getCachedMessage(interaction.channelId);
			if (msg) await msg.edit({ components: buildPlayerRows(player) }).catch(() => {});
			return interaction.reply({ content: '▶️ Resumed', ephemeral: true });
		} else {
			player.pause(true);
			const msg = getCachedMessage(interaction.channelId);
			if (msg) await msg.edit({ components: buildPlayerRows(player) }).catch(() => {});
			return interaction.reply({ content: '⏸️ Paused', ephemeral: true });
		}
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('Nothing is playing right now.');

		if (player.paused) {
			player.pause(false);
			return message.reply('▶️ Resumed');
		} else {
			player.pause(true);
			return message.reply('⏸️ Paused');
		}
	}
}
