import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
import { buildPlayerRows } from '../../lib/playerButtons';
import { getCachedMessage } from '../../lib/playerMessages';
import { broadcastEvent, broadcastQueueUpdate } from '../../lib/websocket';

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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral });

		if (player.paused) {
			player.pause(false);
			const msg = getCachedMessage(interaction.channelId);
			if (msg) await msg.edit({ components: buildPlayerRows(player) }).catch(() => {});
			broadcastEvent(interaction.guildId, 'pauseStateChange', { paused: false });
			broadcastQueueUpdate(interaction.guildId);
			return interaction.reply({ content: '▶️ Resumed', flags: MessageFlags.Ephemeral });
		} else {
			player.pause(true);
			const msg = getCachedMessage(interaction.channelId);
			if (msg) await msg.edit({ components: buildPlayerRows(player) }).catch(() => {});
			broadcastEvent(interaction.guildId, 'pauseStateChange', { paused: true });
			broadcastQueueUpdate(interaction.guildId);
			return interaction.reply({ content: '⏸️ Paused', flags: MessageFlags.Ephemeral });
		}
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('Nothing is playing right now.');

		if (player.paused) {
			player.pause(false);
			broadcastEvent(message.guildId, 'pauseStateChange', { paused: false });
			broadcastQueueUpdate(message.guildId);
			return message.reply('▶️ Resumed');
		} else {
			player.pause(true);
			broadcastEvent(message.guildId, 'pauseStateChange', { paused: true });
			broadcastQueueUpdate(message.guildId);
			return message.reply('⏸️ Paused');
		}
	}
}
