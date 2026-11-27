import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, requireMember, restText, usage, type ModContext } from '../../lib/modCommand';
import { MAX_TIMEOUT_MS, formatDuration, parseDuration } from '../../lib/moderation';

@ApplyOptions<ModCommandOptions>({
	name: 'timeout',
	description: "Time a member out with Discord's native mute (up to 28 days)",
	permission: PermissionFlagsBits.ModerateMembers
})
export class TimeoutCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to time out').setRequired(true))
				.addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 10m, 2h, 7d (max 28d)').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(
				contextOf(interaction),
				interaction.options.getUser('user', true),
				interaction.options.getString('duration', true),
				interaction.options.getString('reason')
			)
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const user = await pickUser(args);
			const duration = await args.pick('string').catch(() => null);
			if (!user || !duration) usage('`%timeout @user <duration> [reason]` (e.g. `%timeout @someone 10m spamming`)');
			return this.execute(contextOf(message), user, duration, await restText(args));
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, durationText: string, reason: string | null) {
		const durationMs = parseDuration(durationText);
		if (!durationMs) throw new ModError(`"${durationText}" isn't a duration I understand. try \`10m\`, \`2h\` or \`7d\`.`);
		if (durationMs > MAX_TIMEOUT_MS) throw new ModError('Discord caps timeouts at 28 days.');

		const member = await requireMember(guild, user);
		await assertCanModerate(moderator, member);
		if (!member.moderatable) throw new ModError("Discord won't let me time them out (they may be an administrator).");

		const { modCase, dm } = await actWithCase(
			guild,
			{
				action: 'timeout',
				targetId: user.id,
				targetTag: user.username,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason,
				durationMs
			},
			() => member.timeout(durationMs, auditReason(moderator.user, reason)),
			{ notify: user }
		);
		return `🔇 timed out <@${user.id}> for **${formatDuration(durationMs)}**${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase, dm)}`;
	}
}
