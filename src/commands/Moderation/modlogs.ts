import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { Colors, EmbedBuilder, PermissionFlagsBits, type Message, type User } from 'discord.js';
import { respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, usage, type ModContext } from '../../lib/modCommand';
import { countCasesForTarget, formatCaseLine, getCasesForTarget, getNotes, getScheduledActions } from '../../lib/moderation';

/** Embed descriptions cap at 4096 characters; the newest cases that fit are shown. */
const MAX_DESCRIPTION = 4000;

@ApplyOptions<ModCommandOptions>({
	name: 'modlogs',
	description: "A user's moderation history",
	permission: PermissionFlagsBits.ModerateMembers
})
export class ModlogsCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder).addUserOption((o) => o.setName('user').setDescription('Whose history').setRequired(true))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => this.execute(contextOf(interaction), interaction.options.getUser('user', true)), { ephemeral: true });
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const user = await pickUser(args);
			if (!user) usage('`%modlogs @user`');
			return this.execute(contextOf(message), user);
		});
	}

	private async execute({ guild }: ModContext, user: User) {
		const total = countCasesForTarget(guild.id, user.id);
		const cases = getCasesForTarget(guild.id, user.id, 50);
		const lines: string[] = [];
		let length = 0;
		for (const modCase of cases) {
			const line = formatCaseLine(modCase);
			if (length + line.length + 1 > MAX_DESCRIPTION) break;
			lines.push(line);
			length += line.length + 1;
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Blurple)
			.setTitle(`Mod history: ${user.username}`)
			.setDescription(lines.length ? lines.join('\n') : '_No cases._')
			.setFooter({ text: `${total} case(s)${total > lines.length ? `, newest ${lines.length} shown` : ''} · User ID: ${user.id}` });

		const pending = getScheduledActions(guild.id, user.id);
		if (pending.length) {
			embed.addFields({
				name: 'Pending',
				value: pending
					.map((action) => {
						const what = action.action === 'unban' ? 'Unban' : `Remove <@&${action.role_id}>`;
						return `${what} <t:${Math.floor(new Date(action.run_at).getTime() / 1000)}:R>${action.case_number ? ` (case #${action.case_number})` : ''}`;
					})
					.join('\n')
			});
		}
		const notes = getNotes(guild.id, user.id, 1000).length;
		if (notes) embed.addFields({ name: 'Notes', value: `${notes} note(s), see \`/note list\`` });
		return { embeds: [embed] };
	}
}
