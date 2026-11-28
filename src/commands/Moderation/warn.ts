import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { actWithCase, assertCanModerate, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, requireMember, restText, usage, type ModContext } from '../../lib/modCommand';
import { escalateWarnings } from '../../lib/warnEscalation';

@ApplyOptions<ModCommandOptions>({
	name: 'warn',
	description: 'Warn a member (stored as a case)',
	permission: PermissionFlagsBits.ModerateMembers
})
export class WarnCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to warn').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(contextOf(interaction), interaction.options.getUser('user', true), interaction.options.getString('reason', true))
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const user = await pickUser(args);
			const reason = await restText(args);
			if (!user || !reason) usage('`%warn @user <reason>`');
			return this.execute(contextOf(message), user, reason);
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, reason: string) {
		const member = await requireMember(guild, user);
		await assertCanModerate(moderator, member);
		const { modCase, dm } = await actWithCase(
			guild,
			{ action: 'warn', targetId: user.id, targetTag: user.username, moderatorId: moderator.id, moderatorTag: moderator.user.username, reason },
			async () => undefined,
			{ notify: user }
		);
		const escalation = await escalateWarnings(guild, member);
		return `⚠️ warned <@${user.id}>: ${modCase.reason}\n${caseSuffix(modCase, dm)}${escalation ? `\n${escalation}` : ''}`;
	}
}
