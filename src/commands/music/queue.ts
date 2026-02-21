import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';

@ApplyOptions<Command.Options>({
	name: 'queue',
	description: 'display the current music queue',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (interaction.member === null) return interaction.reply(`uh oh stinky a bomb will go off now`);

		const queue = player.nodes.get(interaction.guild!);

		// Debug logging
		this.container.logger.debug(`Queue command - Queue exists: ${!!queue}`);
		if (queue) {
			this.container.logger.debug(
				`Queue status - playing: ${queue.node.isPlaying()}, paused: ${queue.node.isPaused()}, current track: ${!!queue.currentTrack}, queue size: ${queue.tracks.size}`
			);
		}

		if (!queue) {
			return interaction.reply('No queue found - nothing has been played yet.');
		}

		const currentTrack = queue.currentTrack;
		const tracks = queue.tracks.toArray();

		// Check if there's anything to show - FIXED LOGIC
		if (!currentTrack && tracks.length === 0) {
			return interaction.reply('There is nothing playing or queued right now.');
		}

		const status = [
			`**Queue Status:**`,
			`🎵 **Now Playing:** ${currentTrack?.title ?? 'Nothing'}`,
			`🎛️ **Volume:** ${queue.node.volume}%`,
			`⏸️ **Paused:** ${queue.node.isPaused() ? 'Yes' : 'No'}`,
			`🎮 **Playing:** ${queue.node.isPlaying() ? 'Yes' : 'No'}`,
			`🔊 **Connection:** ${queue.connection?.state.status ?? 'Disconnected'}`,
			`📋 **Queue Length:** ${tracks.length} tracks`,
			`🔄 **Node Status:** ${queue.node.isIdle() ? 'Idle' : 'Active'}`,
			``
		];

		if (currentTrack) {
			status.push(`**Currently Playing:**`);
			status.push(`• **${currentTrack.title}** by **${currentTrack.author}**`);
			status.push(`• Duration: ${currentTrack.duration}`);
			status.push(`• Requested by: <@${currentTrack.requestedBy?.id || 'Unknown'}>`);
			status.push(``);
		}

		if (tracks.length > 0) {
			status.push(`**Up Next:**`);
			tracks.slice(0, 5).forEach((t, i) => {
				status.push(`${i + 1}. **${t.title ?? 'Unknown Title'}** by **${t.author ?? 'Unknown Artist'}**`);
			});

			if (tracks.length > 5) {
				status.push(`... and ${tracks.length - 5} more tracks`);
			}
		} else if (currentTrack) {
			status.push(`**No tracks in queue**`);
		}

		const description = status.join('\n');

		return interaction.reply({
			content: description,
			ephemeral: false
		});
	}
}
