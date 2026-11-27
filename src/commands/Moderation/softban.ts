import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix, respond } from '../../lib/modActions';
import {
	DELETE_CHOICES,
	ModCommand,
	type ModCommandOptions,
	contextOf,
	parseDeleteOption,
	pickUser,
	requireMember,
	restText,
	usage,
	type ModContext
} from '../../lib/modCommand';

const DEFAULT_DELETE_SECONDS = 86_400;

@ApplyOptions<ModCommandOptions>({
	name: 'softban',
	description: 'Ban and immediately unban a member, deleting their recent messages',
	permission: PermissionFlagsBits.BanMembers,
	options: ['delete']
})
export class SoftbanCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to softban').setRequired(true))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
				.addIntegerOption((o) =>
					o
						.setName('delete_messages')
						.setDescription('How much of their history to delete (default 24 hours)')
						.addChoices(...DELETE_CHOICES.filter((choice) => choice.value > 0))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(
				contextOf(interaction),
				interaction.options.getUser('user', true),
				interaction.options.getString('reason'),
				interaction.options.getInteger('delete_messages') ?? DEFAULT_DELETE_SECONDS
			)
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const option = args.getOption('delete');
			const deleteSeconds = option === null ? DEFAULT_DELETE_SECONDS : parseDeleteOption(option);
			const user = await pickUser(args);
			if (!user) usage('`%softban @user [reason] [--delete=1d]`');
			return this.execute(contextOf(message), user, await restText(args), deleteSeconds);
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, reason: string | null, deleteSeconds: number) {
		const member = await requireMember(guild, user);
		await assertCanModerate(moderator, member);
		if (!member.bannable) throw new ModError("Discord won't let me ban them.");

		const audit = auditReason(moderator.user, reason ? `softban: ${reason}` : 'softban');
		const { modCase, dm } = await actWithCase(
			guild,
			{
				action: 'softban',
				targetId: user.id,
				targetTag: user.username,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason
			},
			async () => {
				await guild.bans.create(user.id, { reason: audit, deleteMessageSeconds: Math.max(deleteSeconds, 1) });
				await guild.bans.remove(user.id, audit);
			},
			{ notify: user }
		);
		return `🧹 softbanned <@${user.id}> (messages cleared, they can rejoin)${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase, dm)}`;
	}
}
