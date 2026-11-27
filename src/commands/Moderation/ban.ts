import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix, fetchMember, respond } from '../../lib/modActions';
import {
	DELETE_CHOICES,
	ModCommand,
	type ModCommandOptions,
	contextOf,
	parseDeleteOption,
	pickOptional,
	pickUser,
	restText,
	usage,
	type ModContext
} from '../../lib/modCommand';
import { MAX_SCHEDULED_MS, cancelScheduledAction, formatDuration, parseDuration, scheduleAction } from '../../lib/moderation';

@ApplyOptions<ModCommandOptions>({
	name: 'ban',
	description: 'Ban a user, optionally for a set time (auto-unban)',
	permission: PermissionFlagsBits.BanMembers,
	options: ['delete']
})
export class BanCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to ban (works for people not in the server too)').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
				.addStringOption((o) => o.setName('duration').setDescription('Temp-ban length, e.g. 1d or 2w (omit for permanent)'))
				.addIntegerOption((o) =>
					o
						.setName('delete_messages')
						.setDescription('Delete their recent messages')
						.addChoices(...DELETE_CHOICES)
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => {
			const durationText = interaction.options.getString('duration');
			const durationMs = durationText === null ? null : parseDuration(durationText);
			if (durationText !== null && durationMs === null)
				throw new ModError(`"${durationText}" isn't a duration I understand. try \`1d\` or \`2w\`.`);
			return this.execute(
				contextOf(interaction),
				interaction.options.getUser('user', true),
				interaction.options.getString('reason'),
				durationMs,
				interaction.options.getInteger('delete_messages') ?? 0
			);
		});
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const deleteSeconds = parseDeleteOption(args.getOption('delete'));
			const user = await pickUser(args);
			if (!user) usage('`%ban @user [duration] [reason] [--delete=1d]` (e.g. `%ban @someone 7d raiding --delete=1d`)');
			const durationMs = await pickOptional(args, parseDuration);
			return this.execute(contextOf(message), user, await restText(args), durationMs, deleteSeconds);
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, reason: string | null, durationMs: number | null, deleteSeconds: number) {
		if (durationMs !== null && durationMs > MAX_SCHEDULED_MS)
			throw new ModError('temp-bans max out at a year. leave the duration off for a permanent ban.');
		const member = await fetchMember(guild, user.id);
		await assertCanModerate(moderator, member, user.id);
		if (member && !member.bannable) throw new ModError("Discord won't let me ban them.");

		const { modCase, dm } = await actWithCase(
			guild,
			{
				action: 'ban',
				targetId: user.id,
				targetTag: user.username,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason,
				durationMs
			},
			() => guild.bans.create(user.id, { reason: auditReason(moderator.user, reason), deleteMessageSeconds: deleteSeconds }),
			// Only members can be DMed: someone outside the server shares nothing with the bot.
			{ notify: member ? user : undefined }
		);

		if (durationMs !== null && modCase.expires_at) {
			scheduleAction(guild.id, 'unban', user.id, new Date(modCase.expires_at), modCase.case_number);
		} else {
			// A permanent ban replaces any temp-ban that was counting down.
			cancelScheduledAction(guild.id, 'unban', user.id);
		}

		const length = durationMs ? ` for **${formatDuration(durationMs)}**` : '';
		return `🔨 banned <@${user.id}>${length}${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase, dm)}`;
	}
}
