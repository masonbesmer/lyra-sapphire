import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
import type { KazagumoPlayer } from 'kazagumo';
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "nothing's playing right now.", flags: MessageFlags.Ephemeral });

		if (player.paused) {
			player.pause(false);
			await this.refreshPlayerButtons(interaction.channelId, player);
			broadcastEvent(interaction.guildId, 'pauseStateChange', { paused: false });
			broadcastQueueUpdate(interaction.guildId);
			return interaction.reply({ content: '▶️ resumed', flags: MessageFlags.Ephemeral });
		} else {
			player.pause(true);
			await this.refreshPlayerButtons(interaction.channelId, player);
			broadcastEvent(interaction.guildId, 'pauseStateChange', { paused: true });
			broadcastQueueUpdate(interaction.guildId);
			return interaction.reply({ content: '⏸️ paused', flags: MessageFlags.Ephemeral });
		}
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("nothing's playing right now.");

		if (player.paused) {
			player.pause(false);
			await this.refreshPlayerButtons(message.channelId, player);
			broadcastEvent(message.guildId, 'pauseStateChange', { paused: false });
			broadcastQueueUpdate(message.guildId);
			return message.reply('▶️ resumed');
		} else {
			player.pause(true);
			await this.refreshPlayerButtons(message.channelId, player);
			broadcastEvent(message.guildId, 'pauseStateChange', { paused: true });
			broadcastQueueUpdate(message.guildId);
			return message.reply('⏸️ paused');
		}
	}

	private async refreshPlayerButtons(channelId: string, player: KazagumoPlayer) {
		const msg = getCachedMessage(channelId);
		if (msg) await msg.edit({ components: buildPlayerRows(player) }).catch(() => {});
	}
}
