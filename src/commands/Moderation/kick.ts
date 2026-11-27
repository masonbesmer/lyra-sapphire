import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, requireMember, restText, usage, type ModContext } from '../../lib/modCommand';

@ApplyOptions<ModCommandOptions>({
	name: 'kick',
	description: 'Kick a member from the server',
	permission: PermissionFlagsBits.KickMembers
})
export class KickCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to kick').setRequired(true))
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
			if (!user) usage('`%kick @user [reason]`');
			return this.execute(contextOf(message), user, await restText(args));
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, reason: string | null) {
		const member = await requireMember(guild, user);
		await assertCanModerate(moderator, member);
		if (!member.kickable) throw new ModError("Discord won't let me kick them.");

		const { modCase, dm } = await actWithCase(
			guild,
			{ action: 'kick', targetId: user.id, targetTag: user.username, moderatorId: moderator.id, moderatorTag: moderator.user.username, reason },
			() => member.kick(auditReason(moderator.user, reason)),
			{ notify: user }
		);
		return `👢 kicked <@${user.id}>${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase, dm)}`;
	}
}
