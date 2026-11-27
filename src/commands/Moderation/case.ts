import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message } from 'discord.js';
import { ModError, buildCaseEmbed, refreshModLog, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, restText, usage, type ModContext } from '../../lib/modCommand';
import { deleteCase, getCase, setCaseReason } from '../../lib/moderation';

const USAGE = '`%case view <#>` | `%case edit-reason <#> <reason>` | `%case delete <#>`';

@ApplyOptions<ModCommandOptions>({
	name: 'case',
	description: 'View, edit or delete a moderation case',
	permission: PermissionFlagsBits.ModerateMembers
})
export class CaseCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		const number = <T extends { setName(n: string): T; setDescription(d: string): T; setRequired(r: boolean): T; setMinValue(v: number): T }>(
			o: T
		) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1);
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show a case').addIntegerOption(number))
				.addSubcommand((sub) =>
					sub
						.setName('edit-reason')
						.setDescription("Change a case's reason")
						.addIntegerOption(number)
						.addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(512))
				)
				.addSubcommand((sub) => sub.setName('delete').setDescription('Delete a case (its number is not reused)').addIntegerOption(number))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const sub = interaction.options.getSubcommand(true);
		return respond(
			interaction,
			() => this.execute(contextOf(interaction), sub, interaction.options.getInteger('number', true), interaction.options.getString('reason')),
			{ ephemeral: sub === 'view' }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			const number = await args.pick('integer').catch(() => null);
			if (!['view', 'edit-reason', 'delete'].includes(sub) || !number) usage(USAGE);
			const reason = sub === 'edit-reason' ? await restText(args) : null;
			if (sub === 'edit-reason' && !reason) usage(USAGE);
			return this.execute(contextOf(message), sub, number, reason);
		});
	}

	private async execute({ guild }: ModContext, sub: string, number: number, reason: string | null) {
		const modCase = getCase(guild.id, number);
		if (!modCase) throw new ModError(`there's no case #${number}.`);

		if (sub === 'view') {
			const embed = buildCaseEmbed(modCase);
			if (modCase.log_channel_id && modCase.log_message_id) {
				embed.addFields({
					name: 'Mod log',
					value: `https://discord.com/channels/${guild.id}/${modCase.log_channel_id}/${modCase.log_message_id}`
				});
			}
			return { embeds: [embed] };
		}

		if (sub === 'edit-reason') {
			setCaseReason(guild.id, number, reason);
			const updated = getCase(guild.id, number)!;
			await refreshModLog(guild, updated);
			return `✏️ case #${number}'s reason is now: ${updated.reason}`;
		}

		// delete. The action itself isn't undone (a temp-ban still expires on schedule): this only
		// removes the record.
		deleteCase(guild.id, number);
		return `🗑️ deleted case #${number}. the ${modCase.action} itself still stands.`;
	}
}
