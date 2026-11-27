import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, requireMember, restText, usage, type ModContext } from '../../lib/modCommand';

@ApplyOptions<ModCommandOptions>({
	name: 'untimeout',
	description: "Lift a member's timeout",
	permission: PermissionFlagsBits.ModerateMembers
})
export class UntimeoutCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Whose timeout to lift').setRequired(true))
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
			if (!user) usage('`%untimeout @user [reason]`');
			return this.execute(contextOf(message), user, await restText(args));
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, reason: string | null) {
		const member = await requireMember(guild, user);
		if (!member.isCommunicationDisabled()) throw new ModError(`<@${user.id}> isn't timed out.`);
		await assertCanModerate(moderator, member);

		const { modCase, dm } = await actWithCase(
			guild,
			{
				action: 'untimeout',
				targetId: user.id,
				targetTag: user.username,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason
			},
			() => member.timeout(null, auditReason(moderator.user, reason)),
			{ notify: user }
		);
		return `🔊 lifted <@${user.id}>'s timeout.\n${caseSuffix(modCase, dm)}`;
	}
}
