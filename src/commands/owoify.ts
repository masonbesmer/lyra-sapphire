import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ApplicationCommandType, Message, MessageContextMenuCommandInteraction } from 'discord.js';

@ApplyOptions<Command.Options>({
	description: 'OwOify text'
})
export class UserCommand extends Command {
	// Register Chat Input and Context Menu command
	public override registerApplicationCommands(registry: Command.Registry) {
		// Register Context Menu command available from any message
		registry.registerContextMenuCommand({
			name: this.name,
			type: ApplicationCommandType.Message
		});

		// Register Context Menu command available from any user
		registry.registerContextMenuCommand({
			name: this.name,
			type: ApplicationCommandType.User
		});
	}

	// Message command
	public override async messageRun(message: Message) {
		return this.owoifyTxt(message);
	}

	// Context Menu command
	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		return this.owoifyTxt(interaction);
	}

	private async owoifyTxt(interactionOrMessage: Message | Command.ChatInputCommandInteraction | Command.ContextMenuCommandInteraction) {
		const owoMessage = await interactionOrMessage.reply({ content: "hold on i'm UwUing x3" });

		if (interactionOrMessage instanceof Message) {
			const Uwuified = interactionOrMessage
				.toString()
				.replace(/.+owoify /, '')
				.replace(/(?:r|l)/g, 'w')
				.replace(/(?:ve)/g, 'z');

			const content = `UwU ${Uwuified} :3c`;

			return owoMessage.edit({ content });
		}
		//return;

		const Uwuified = (interactionOrMessage as MessageContextMenuCommandInteraction).targetMessage.content
			.replace(/.+owoify /, '')
			.replace(/(?:r|l)/g, 'w')
			.replace(/(?:ve)/g, 'z');

		const content = `UwU ${Uwuified} :3c`;

		return interactionOrMessage.editReply({
			content: content
		});
	}
}
