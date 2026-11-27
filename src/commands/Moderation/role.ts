import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type Role, type User } from 'discord.js';
import { ModError, actWithCase, assertCanManageRole, assertCanModerate, auditReason, caseSuffix, respond } from '../../lib/modActions';
import {
	ModCommand,
	type ModCommandOptions,
	contextOf,
	pickOptional,
	pickUser,
	requireMember,
	restText,
	usage,
	type ModContext
} from '../../lib/modCommand';
import { MAX_SCHEDULED_MS, cancelScheduledAction, formatDuration, parseDuration, scheduleAction } from '../../lib/moderation';

const USAGE = '`%role add @user @role [duration] [reason]` | `%role remove @user @role [reason]`';

@ApplyOptions<ModCommandOptions>({
	name: 'role',
	description: "Add or remove a member's role, optionally for a set time",
	permission: PermissionFlagsBits.ManageRoles
})
export class RoleCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Give a member a role')
						.addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
						.addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
						.addStringOption((o) => o.setName('duration').setDescription('Remove it again after, e.g. 1h or 7d (omit to keep)'))
						.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Take a role from a member')
						.addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
						.addRoleOption((o) => o.setName('role').setDescription('Which role').setRequired(true))
						.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => {
			const ctx = contextOf(interaction);
			const sub = interaction.options.getSubcommand(true) as 'add' | 'remove';
			const roleId = interaction.options.getRole('role', true).id;
			const role = ctx.guild.roles.cache.get(roleId);
			if (!role) throw new ModError("couldn't find that role.");
			const durationText = sub === 'add' ? interaction.options.getString('duration') : null;
			const durationMs = durationText === null ? null : parseDuration(durationText);
			if (durationText !== null && durationMs === null)
				throw new ModError(`"${durationText}" isn't a duration I understand. try \`1h\` or \`7d\`.`);
			return this.execute(ctx, sub, interaction.options.getUser('user', true), role, durationMs, interaction.options.getString('reason'));
		});
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			if (sub !== 'add' && sub !== 'remove') usage(USAGE);
			const user = await pickUser(args);
			const role = await args.pick('role').catch(() => null);
			if (!user || !role) usage(USAGE);
			const durationMs = sub === 'add' ? await pickOptional(args, parseDuration) : null;
			return this.execute(contextOf(message), sub, user, role, durationMs, await restText(args));
		});
	}

	private async execute(
		{ guild, moderator }: ModContext,
		sub: 'add' | 'remove',
		user: User,
		role: Role,
		durationMs: number | null,
		reason: string | null
	) {
		if (durationMs !== null && durationMs > MAX_SCHEDULED_MS)
			throw new ModError('timed roles max out at a year. leave the duration off to keep it.');
		const member = await requireMember(guild, user);
		if (member.id !== moderator.id) await assertCanModerate(moderator, member);
		await assertCanManageRole(moderator, role);

		const has = member.roles.cache.has(role.id);
		if (sub === 'add' && has && durationMs === null) throw new ModError(`<@${user.id}> already has <@&${role.id}>.`);
		if (sub === 'remove' && !has) throw new ModError(`<@${user.id}> doesn't have <@&${role.id}>.`);

		const audit = auditReason(moderator.user, reason);
		const { modCase } = await actWithCase(
			guild,
			{
				action: sub === 'add' ? 'role-add' : 'role-remove',
				targetId: user.id,
				targetTag: user.username,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason,
				durationMs
			},
			// Re-adding a role they already hold just (re)starts its timer.
			() => (sub === 'add' ? (has ? Promise.resolve() : member.roles.add(role, audit)) : member.roles.remove(role, audit)),
			{ extra: [{ name: 'Role', value: `<@&${role.id}>` }] }
		);

		if (sub === 'add' && durationMs !== null && modCase.expires_at) {
			scheduleAction(guild.id, 'role-remove', user.id, new Date(modCase.expires_at), modCase.case_number, role.id);
			return `➕ gave <@${user.id}> <@&${role.id}> for **${formatDuration(durationMs)}**.\n${caseSuffix(modCase)}`;
		}
		// A permanent add or a manual removal replaces any timer that was running for this role.
		cancelScheduledAction(guild.id, 'role-remove', user.id, role.id);
		return sub === 'add'
			? `➕ gave <@${user.id}> <@&${role.id}>.\n${caseSuffix(modCase)}`
			: `➖ took <@&${role.id}> from <@${user.id}>.\n${caseSuffix(modCase)}`;
	}
}
