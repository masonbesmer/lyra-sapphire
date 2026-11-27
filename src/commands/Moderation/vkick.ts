import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message } from 'discord.js';
import { respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, restText, usage } from '../../lib/modCommand';
import { voiceKick } from '../../lib/modVoice';

@ApplyOptions<ModCommandOptions>({
	name: 'vkick',
	description: 'Disconnect a member from voice',
	permission: PermissionFlagsBits.MoveMembers
})
export class VkickCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			voiceKick(contextOf(interaction), interaction.options.getUser('user', true), interaction.options.getString('reason'))
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const user = await pickUser(args);
			if (!user) usage('`%vkick @user [reason]`');
			return voiceKick(contextOf(message), user, await restText(args));
		});
	}
}
