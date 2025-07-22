import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import type { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
        name: 'restart',
        description: 'Restarts the bot',
        preconditions: ['OwnerOnly']
})
export class RestartCommand extends Command {
        public override registerApplicationCommands(registry: Command.Registry) {
                registry.registerChatInputCommand((builder) =>
                        builder.setName(this.name).setDescription(this.description)
                );
        }

        public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
                await interaction.reply({ content: 'Restarting...', ephemeral: true });
                await this.container.client.destroy();
                process.exit(0);
        }

        public override async messageRun(message: Message) {
                await message.reply('Restarting...');
                await this.container.client.destroy();
                process.exit(0);
        }
}

