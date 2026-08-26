import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import type { KazagumoTrack } from 'kazagumo';
import { MessageFlags, Message } from 'discord.js';
import { formatDuration } from '../../lib/music';

@ApplyOptions<Command.Options>({
	name: 'queue',
	description: 'display the current music queue',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	private buildQueueResponse(guildId: string): string {
		const player = this.container.client.kazagumo.getPlayer(guildId);
		if (!player) return "nothing's been played yet.";

		const currentTrack = player.queue.current;
		const tracks = [...player.queue] as KazagumoTrack[];

		if (!currentTrack && tracks.length === 0) return "nothing's playing or queued right now.";

		const requester = currentTrack?.requester as { id?: string } | null | undefined;
		const status = [
			`**Queue Status:**`,
			`🎵 **Now Playing:** ${currentTrack?.title ?? 'Nothing'}`,
			`🎛️ **Volume:** ${player.volume}%`,
			`⏸️ **Paused:** ${player.paused ? 'Yes' : 'No'}`,
			`🎮 **Playing:** ${player.playing ? 'Yes' : 'No'}`,
			`📋 **Queue Length:** ${tracks.length} tracks`,
			``
		];

		if (currentTrack) {
			status.push(`**Currently Playing:**`);
			status.push(`• **${currentTrack.title}** by **${currentTrack.author ?? 'Unknown'}**`);
			status.push(`• Duration: ${formatDuration(currentTrack.length ?? 0)}`);
			status.push(`• Requested by: ${requester?.id ? `<@${requester.id}>` : 'Unknown'}`);
			status.push(``);
		}

		if (tracks.length > 0) {
			status.push(`**Up Next:**`);
			tracks.slice(0, 5).forEach((t, i) => {
				status.push(`${i + 1}. **${t.title ?? 'Unknown Title'}** by **${t.author ?? 'Unknown Artist'}**`);
			});
			if (tracks.length > 5) status.push(`... and ${tracks.length - 5} more tracks`);
		} else if (currentTrack) {
			status.push(`**No tracks in queue**`);
		}

		return status.join('\n');
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		return interaction.reply({ content: this.buildQueueResponse(interaction.guildId) });
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		return message.reply(this.buildQueueResponse(message.guildId));
	}
}
