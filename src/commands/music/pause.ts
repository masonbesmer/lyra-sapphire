import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
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
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });

		if (queue.node.isPaused()) {
			queue.node.resume();
			const msg = getCachedMessage(interaction.channelId);
			if (msg) await msg.edit({ components: buildPlayerRows(queue) }).catch(() => {});
			return interaction.reply({ content: '▶️ Resumed', ephemeral: true });
		} else {
			queue.node.pause();
			const msg = getCachedMessage(interaction.channelId);
			if (msg) await msg.edit({ components: buildPlayerRows(queue) }).catch(() => {});
			return interaction.reply({ content: '⏸️ Paused', ephemeral: true });
		}
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('Nothing is playing right now.');

		if (queue.node.isPaused()) {
			queue.node.resume();
			return message.reply('▶️ Resumed');
		} else {
			queue.node.pause();
			return message.reply('⏸️ Paused');
		}
	}
}
