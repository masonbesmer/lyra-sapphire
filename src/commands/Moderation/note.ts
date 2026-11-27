import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { Colors, EmbedBuilder, PermissionFlagsBits, type Message, type User } from 'discord.js';
import { ModError, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, usage, type ModContext } from '../../lib/modCommand';
import { MAX_NOTE_LENGTH, addNote, deleteNote, getNotes } from '../../lib/moderation';

const USAGE = '`%note add @user <text>` | `%note list @user` | `%note remove <id>`';

@ApplyOptions<ModCommandOptions>({
	name: 'note',
	description: 'Private moderator notes on a user (they never see them)',
	permission: PermissionFlagsBits.ModerateMembers
})
export class NoteCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add a note')
						.addUserOption((o) => o.setName('user').setDescription('About whom').setRequired(true))
						.addStringOption((o) => o.setName('text').setDescription('The note').setRequired(true).setMaxLength(MAX_NOTE_LENGTH))
				)
				.addSubcommand((sub) =>
					sub
						.setName('list')
						.setDescription("List a user's notes")
						.addUserOption((o) => o.setName('user').setDescription('Whose notes').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Delete a note')
						.addIntegerOption((o) => o.setName('id').setDescription('Note ID (from /note list)').setRequired(true).setMinValue(1))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const sub = interaction.options.getSubcommand(true);
		return respond(
			interaction,
			() =>
				this.execute(
					contextOf(interaction),
					sub,
					interaction.options.getUser('user'),
					interaction.options.getString('text'),
					interaction.options.getInteger('id')
				),
			{ ephemeral: true }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			if (sub === 'remove') {
				const id = await args.pick('integer').catch(() => null);
				if (!id) usage(USAGE);
				return this.execute(contextOf(message), sub, null, null, id);
			}
			if (sub !== 'add' && sub !== 'list') usage(USAGE);
			const user = await pickUser(args);
			if (!user) usage(USAGE);
			const text = sub === 'add' ? await args.rest('string').catch(() => null) : null;
			if (sub === 'add' && !text?.trim()) usage(USAGE);
			return this.execute(contextOf(message), sub, user, text, null);
		});
	}

	private async execute({ guild, moderator }: ModContext, sub: string, user: User | null, text: string | null, id: number | null) {
		if (sub === 'remove') {
			if (!deleteNote(guild.id, id!)) throw new ModError(`there's no note #${id}.`);
			return `🗑️ deleted note #${id}.`;
		}
		if (sub === 'add') {
			const note = addNote(guild.id, user!.id, moderator.id, moderator.user.username, text!);
			return `📝 noted on <@${user!.id}> (note #${note.id}).`;
		}
		const notes = getNotes(guild.id, user!.id, 20);
		if (notes.length === 0) return `no notes on <@${user!.id}>.`;
		const embed = new EmbedBuilder()
			.setColor(Colors.Greyple)
			.setTitle(`Notes: ${user!.username}`)
			.setDescription(
				notes
					.map(
						(note) =>
							`**#${note.id}** <t:${Math.floor(new Date(note.created_at).getTime() / 1000)}:d> by <@${note.author_id}>\n${note.content}`
					)
					.join('\n\n')
					.slice(0, 4000)
			);
		return { embeds: [embed] };
	}
}
