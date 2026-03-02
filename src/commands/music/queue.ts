import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember, Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'queue',
	description: 'display the current music queue',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
	}

	private async buildQueueResponse(guildId: string): Promise<string> {
		const player = useMainPlayer();
		const queue = player.nodes.get(guildId);

		if (!queue) return 'No queue found - nothing has been played yet.';

		const currentTrack = queue.currentTrack;
		const tracks = queue.tracks.toArray();

		if (!currentTrack && tracks.length === 0) return 'There is nothing playing or queued right now.';

		const status = [
			`**Queue Status:**`,
			`🎵 **Now Playing:** ${currentTrack?.title ?? 'Nothing'}`,
			`🎛️ **Volume:** ${queue.node.volume}%`,
			`⏸️ **Paused:** ${queue.node.isPaused() ? 'Yes' : 'No'}`,
			`🎮 **Playing:** ${queue.node.isPlaying() ? 'Yes' : 'No'}`,
			`📋 **Queue Length:** ${tracks.length} tracks`,
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
			if (tracks.length > 5) status.push(`... and ${tracks.length - 5} more tracks`);
		} else if (currentTrack) {
			status.push(`**No tracks in queue**`);
		}

		return status.join('\n');
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		this.container.logger.debug(`Queue command invoked by ${interaction.user.tag}`);
		const description = await this.buildQueueResponse(interaction.guildId);
		return interaction.reply({ content: description, ephemeral: false });
	}

	public override async messageRun(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const description = await this.buildQueueResponse(message.guildId);
		return message.reply(description);
	}
}
