import { Listener } from '@sapphire/framework';
import { ButtonInteraction } from 'discord.js';
import { QueueRepeatMode, useMainPlayer } from 'discord-player';

export class PlayerControlsListener extends Listener {
    public constructor(context: Listener.LoaderContext, options: Listener.Options) {
        super(context, { ...options, event: 'interactionCreate' });
    }

    public async run(interaction: ButtonInteraction) {
        if (!interaction.isButton()) return;
        const player = useMainPlayer();
        const queue = player.nodes.get(interaction.guildId!);
        if (!queue) return;

        switch (interaction.customId) {
            case 'player_skip':
                queue.node.skip();
                return interaction.reply({ content: '⏭️ Skipped', ephemeral: true });
            case 'player_pause':
                if (queue.node.isPaused()) {
                    queue.node.resume();
                    return interaction.reply({ content: '▶️ Resumed', ephemeral: true });
                }
                queue.node.pause();
                return interaction.reply({ content: '⏸️ Paused', ephemeral: true });
            case 'player_repeat':
                const newMode =
                    queue.repeatMode === QueueRepeatMode.TRACK ? QueueRepeatMode.OFF : QueueRepeatMode.TRACK;
                queue.setRepeatMode(newMode);
                return interaction.reply({
                    content: newMode === QueueRepeatMode.TRACK ? '🔂 Repeat enabled' : '🔂 Repeat disabled',
                    ephemeral: true
                });
            case 'player_seek_forward':
                await queue.node.seek(queue.node.streamTime + 10000);
                return interaction.reply({ content: '⏩ Forward 10s', ephemeral: true });
            case 'player_seek_back':
                await queue.node.seek(Math.max(queue.node.streamTime - 10000, 0));
                return interaction.reply({ content: '⏪ Back 10s', ephemeral: true });
            default:
                return;
        }
    }
}
