import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, requireMember, restText, usage, type ModContext } from '../../lib/modCommand';

/** Discord's nickname limit. */
const MAX_NICK = 32;

@ApplyOptions<ModCommandOptions>({
	name: 'nick',
	description: "Set or reset a member's nickname",
	permission: PermissionFlagsBits.ManageNicknames
})
export class NickCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Whose nickname').setRequired(true))
				.addStringOption((o) => o.setName('nickname').setDescription('New nickname (omit to reset)').setMaxLength(MAX_NICK))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(
				contextOf(interaction),
				interaction.options.getUser('user', true),
				interaction.options.getString('nickname'),
				interaction.options.getString('reason')
			)
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const user = await pickUser(args);
			if (!user) usage('`%nick @user <nickname|reset>`');
			const text = await restText(args);
			return this.execute(contextOf(message), user, text === null || text.toLowerCase() === 'reset' ? null : text, null);
		});
	}

	private async execute({ guild, moderator }: ModContext, user: User, nickname: string | null, reason: string | null) {
		if (nickname !== null && nickname.length > MAX_NICK) throw new ModError(`nicknames max out at ${MAX_NICK} characters.`);
		const member = await requireMember(guild, user);
		// Changing your own nickname is fine; the hierarchy rules are about acting on others.
		if (member.id !== moderator.id) await assertCanModerate(moderator, member);
		if (!member.manageable) throw new ModError("Discord won't let me change their nickname.");

		const before = member.nickname;
		if (before === nickname) throw new ModError(nickname === null ? "they don't have a nickname." : 'that is already their nickname.');
		const { modCase } = await actWithCase(
			guild,
			{ action: 'nick', targetId: user.id, targetTag: user.username, moderatorId: moderator.id, moderatorTag: moderator.user.username, reason },
			() => member.setNickname(nickname, auditReason(moderator.user, reason)),
			{ extra: [{ name: 'Nickname', value: `${before ?? '_none_'} → ${nickname ?? '_reset_'}` }] }
		);
		return `${nickname === null ? `📛 reset <@${user.id}>'s nickname.` : `📛 <@${user.id}> is **${nickname}** now.`}\n${caseSuffix(modCase)}`;
	}
}
