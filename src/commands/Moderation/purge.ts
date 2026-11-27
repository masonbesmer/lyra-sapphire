import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { Collection, PermissionFlagsBits, type GuildTextBasedChannel, type Message } from 'discord.js';
import { ModError, actWithCase, caseSuffix, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, usage, type ModContext } from '../../lib/modCommand';
import { describePurgeFilter, matchesPurgeFilter, type PurgeFilter } from '../../lib/moderation';

const MAX_PURGE = 100;
/** With a filter, how far back to look for matches. Five API pages. */
const MAX_SCAN = 500;

@ApplyOptions<ModCommandOptions>({
	name: 'purge',
	description: 'Bulk-delete recent messages, optionally filtered (only messages under 14 days old)',
	permission: PermissionFlagsBits.ManageMessages,
	flags: ['bots', 'links', 'attachments', 'embeds'],
	options: ['contains']
})
export class PurgeCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addIntegerOption((o) =>
					o
						.setName('count')
						.setDescription(`How many messages to delete (1-${MAX_PURGE})`)
						.setRequired(true)
						.setMinValue(1)
						.setMaxValue(MAX_PURGE)
				)
				.addUserOption((o) => o.setName('user').setDescription('Only messages from this user'))
				.addBooleanOption((o) => o.setName('bots').setDescription('Only messages from bots'))
				.addBooleanOption((o) => o.setName('links').setDescription('Only messages with links'))
				.addBooleanOption((o) => o.setName('attachments').setDescription('Only messages with attachments'))
				.addBooleanOption((o) => o.setName('embeds').setDescription('Only messages with embeds'))
				.addStringOption((o) => o.setName('contains').setDescription('Only messages containing this text').setMaxLength(200))
				.addStringOption((o) => o.setName('reason').setDescription('Why (for the mod log)').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(
			interaction,
			() =>
				this.execute(
					contextOf(interaction),
					interaction.inCachedGuild() ? interaction.channel : null,
					interaction.options.getInteger('count', true),
					{
						userId: interaction.options.getUser('user')?.id ?? null,
						bots: interaction.options.getBoolean('bots') ?? false,
						links: interaction.options.getBoolean('links') ?? false,
						attachments: interaction.options.getBoolean('attachments') ?? false,
						embeds: interaction.options.getBoolean('embeds') ?? false,
						contains: interaction.options.getString('contains')
					},
					interaction.options.getString('reason'),
					null
				),
			{ defer: true, ephemeral: true }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const count = await args.pick('integer').catch(() => null);
			if (!count || count < 1 || count > MAX_PURGE) {
				usage(`\`%purge <1-${MAX_PURGE}> [@user] [--bots] [--links] [--attachments] [--embeds] [--contains=text]\``);
			}
			const user = await pickUser(args);
			const filter: PurgeFilter = {
				userId: user?.id ?? null,
				bots: args.getFlags('bots'),
				links: args.getFlags('links'),
				attachments: args.getFlags('attachments'),
				embeds: args.getFlags('embeds'),
				contains: args.getOption('contains')
			};
			// Messages before the command itself, so `%purge 10` deletes ten messages, not nine plus the command.
			return this.execute(contextOf(message), message.channel as GuildTextBasedChannel, count, filter, null, message.id);
		});
	}

	private async execute(
		{ guild, moderator }: ModContext,
		channel: GuildTextBasedChannel | null,
		count: number,
		filter: PurgeFilter,
		reason: string | null,
		before: string | null
	) {
		if (!channel || !('bulkDelete' in channel)) throw new ModError("I can't purge in this kind of channel.");
		const filtered = describePurgeFilter(filter);

		const matched = new Collection<string, Message>();
		let cursor = before ?? undefined;
		let scanned = 0;
		const scanLimit = filtered ? MAX_SCAN : count;
		while (matched.size < count && scanned < scanLimit) {
			const page = await channel.messages.fetch({ limit: Math.min(100, scanLimit - scanned), before: cursor });
			if (page.size === 0) break;
			scanned += page.size;
			cursor = page.lastKey();
			let stop = false;
			for (const message of page.values()) {
				const candidate = {
					authorId: message.author.id,
					authorBot: message.author.bot,
					content: message.content,
					attachmentCount: message.attachments.size,
					embedCount: message.embeds.length,
					createdTimestamp: message.createdTimestamp,
					pinned: message.pinned
				};
				if (!matchesPurgeFilter(candidate, filter)) {
					// Pages are newest first: once one message is too old to bulk-delete, they all are.
					if (Date.now() - message.createdTimestamp >= 14 * 24 * 60 * 60 * 1000) stop = true;
					continue;
				}
				matched.set(message.id, message);
				if (matched.size >= count) break;
			}
			if (stop) break;
		}

		if (matched.size === 0)
			throw new ModError(
				`nothing to delete${filtered ? ` ${filtered}` : ''} in the last ${scanned} messages (skipping pinned and 14+ day old ones).`
			);

		let deleted = 0;
		const { modCase } = await actWithCase(
			guild,
			{
				action: 'purge',
				targetType: 'channel',
				targetId: channel.id,
				targetTag: channel.name,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason
			},
			async () => {
				const result = await channel.bulkDelete(matched, true);
				deleted = result.size;
			},
			{ extra: [{ name: 'Deleted', value: `${matched.size} message(s)${filtered ? ` ${filtered}` : ''}` }] }
		);
		return `🗑️ deleted **${deleted}** message(s)${filtered ? ` ${filtered}` : ''} in <#${channel.id}>.\n${caseSuffix(modCase)}`;
	}
}
