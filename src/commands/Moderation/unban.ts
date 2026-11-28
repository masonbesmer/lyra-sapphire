import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { actWithCase, auditReason, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, restText, usage, type ModContext } from '../../lib/modCommand';
import { cancelScheduledAction } from '../../lib/moderation';

@ApplyOptions<ModCommandOptions>({
	name: 'unban',
	description: 'Lift a ban',
	permission: PermissionFlagsBits.BanMembers
})
export class UnbanCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to unban (paste their user ID)').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(contextOf(interaction), interaction.options.getUser('user', true), interaction.options.getString('reason'))
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const user = await pickUser(args);
			if (!user) usage('`%unban <user id> [reason]`');
			return this.execute(contextOf(message), user, await restText(args));
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, reason: string | null) {
		// Throws UnknownBan (→ "that user isn't banned.") before any case exists.
		await guild.bans.fetch({ user: user.id, force: true });
		const { modCase } = await actWithCase(
			guild,
			{
				action: 'unban',
				targetId: user.id,
				targetTag: user.username,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason
			},
			() => guild.bans.remove(user.id, auditReason(moderator.user, reason))
		);
		cancelScheduledAction(guild.id, 'unban', user.id);
		return `🕊️ unbanned <@${user.id}>.\n${caseSuffix(modCase)}`;
	}
}
