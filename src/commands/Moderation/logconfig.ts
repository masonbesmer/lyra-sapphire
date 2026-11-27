import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import {
	LOG_CHANNEL_PERMISSIONS,
	LOG_EVENTS,
	LOG_EVENT_LABELS,
	LOG_GROUPS,
	addLogIgnore,
	getLogIgnores,
	getLogRoutes,
	removeLogIgnore,
	resolveLogEvents,
	setLogRoutes,
	truncate,
	type LogIgnoreType
} from '../../lib/eventLog';
import { primeInvites } from '../../lib/eventLogPost';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';

const USAGE =
	'`%logconfig view` | `%logconfig channel <event|group|all> [#channel|clear]` | `%logconfig ignore <#channel|@user>` | `%logconfig unignore <#channel|@user>`';

/** `all`, then the groups, then each event: 20 choices, under Discord's 25. */
const EVENT_CHOICES = [
	{ name: 'all events', value: 'all' },
	...Object.keys(LOG_GROUPS).map((group) => ({ name: `${group} (group)`, value: group })),
	...LOG_EVENTS.map((event) => ({ name: event, value: event }))
];

interface Request {
	sub: string;
	selector: string | null;
	channelId: string | null;
	ignore: { type: LogIgnoreType; id: string } | null;
}

@ApplyOptions<ModCommandOptions>({
	name: 'logconfig',
	description: 'Event logging: which channel each event goes to, and what to ignore',
	permission: PermissionFlagsBits.ManageGuild,
	// Storing settings needs nothing; the channel check below covers posting.
	clientPermission: 0n
})
export class LogconfigCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show where each event is logged and what is ignored'))
				.addSubcommand((sub) =>
					sub
						.setName('channel')
						.setDescription('Send an event (or a group of them) to a channel; omit the channel to stop logging it')
						.addStringOption((o) =>
							o
								.setName('event')
								.setDescription('Which event or group')
								.setRequired(true)
								.addChoices(...EVENT_CHOICES)
						)
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('The log channel')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('ignore')
						.setDescription('Stop logging events in a channel (or category) or by a user')
						.addChannelOption((o) => o.setName('channel').setDescription('Channel or category to ignore'))
						.addUserOption((o) => o.setName('user').setDescription('User to ignore'))
				)
				.addSubcommand((sub) =>
					sub
						.setName('unignore')
						.setDescription('Log a channel or user again')
						.addChannelOption((o) => o.setName('channel').setDescription('Channel or category'))
						.addUserOption((o) => o.setName('user').setDescription('User'))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => {
			const sub = interaction.options.getSubcommand(true);
			const channelId = interaction.options.getChannel('channel')?.id ?? null;
			const userId = interaction.options.getUser('user')?.id ?? null;
			let ignore: Request['ignore'] = null;
			if (sub === 'ignore' || sub === 'unignore') {
				if (Boolean(channelId) === Boolean(userId)) throw new ModError('give either a channel or a user (one at a time).');
				ignore = channelId ? { type: 'channel', id: channelId } : { type: 'user', id: userId! };
			}
			return this.execute(contextOf(interaction), { sub, selector: interaction.options.getString('event'), channelId, ignore });
		});
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const context = contextOf(message);
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			if (sub === 'view') return this.execute(context, { sub, selector: null, channelId: null, ignore: null });
			if (sub === 'channel') {
				const selector = await args.pick('string').catch(() => null);
				if (!selector) return usage(USAGE);
				const word = await args.pick('string').catch(() => null);
				if (word !== null && word !== 'clear' && !snowflakeFrom(word)) usage(USAGE);
				const channelId = word === null || word === 'clear' ? null : snowflakeFrom(word);
				return this.execute(context, { sub, selector, channelId, ignore: null });
			}
			if (sub === 'ignore' || sub === 'unignore') {
				const word = await args.pick('string').catch(() => '');
				const id = snowflakeFrom(word);
				if (!id) return usage(USAGE);
				// <#id> is a channel and <@id> a user; a bare ID is whichever the server has.
				const type: LogIgnoreType =
					word.startsWith('<#') || (!word.startsWith('<@') && context.guild.channels.cache.has(id)) ? 'channel' : 'user';
				return this.execute(context, { sub, selector: null, channelId: null, ignore: { type, id } });
			}
			return usage(USAGE);
		});
	}

	private async execute({ guild, moderator }: ModContext, request: Request) {
		const actor = auditActor(moderator, 'discord');

		if (request.sub === 'view') {
			const routes = getLogRoutes(guild.id);
			const ignores = getLogIgnores(guild.id);
			const lines = ['**Event logging:**'];
			for (const [group, events] of Object.entries(LOG_GROUPS)) {
				lines.push(`__${group}__`);
				for (const event of events) lines.push(`${event} (${LOG_EVENT_LABELS[event]}): ${routes[event] ? `<#${routes[event]}>` : 'off'}`);
			}
			lines.push(`**Ignored channels:** ${ignores.channel.length ? ignores.channel.map((id) => `<#${id}>`).join(' ') : 'none'}`);
			lines.push(`**Ignored users:** ${ignores.user.length ? ignores.user.map((id) => `<@${id}>`).join(' ') : 'none'}`);
			lines.push('-# Bans, kicks and timeouts done outside Lyra become cases in the mod log (`/modconfig log-channel`).');
			return truncate(lines.join('\n'), 2000);
		}

		if (request.sub === 'channel') {
			const events = resolveLogEvents(request.selector ?? '');
			if (!events.length)
				throw new ModError(`pick \`all\`, a group (${Object.keys(LOG_GROUPS).join(', ')}) or an event (see \`/logconfig view\`).`);
			if (request.channelId) {
				const channel = guild.channels.cache.get(request.channelId);
				const me = guild.members.me ?? (await guild.members.fetchMe());
				if (!channel?.isSendable() || !channel.permissionsFor(me).has(LOG_CHANNEL_PERMISSIONS)) {
					throw new ModError('I need View Channel, Send Messages, Embed Links and Attach Files in that channel.');
				}
			}
			const before = getLogRoutes(guild.id);
			setLogRoutes(guild.id, events, request.channelId);
			for (const event of events) recordConfigChange(guild.id, actor, 'moderation', `log.${event}`, before[event] ?? null, request.channelId);
			if (events.includes('member_join')) await primeInvites(guild);
			const what = events.length === 1 ? events[0] : `${events.length} events (${request.selector})`;
			return request.channelId ? `📋 ${what} → <#${request.channelId}>.` : `📋 ${what}: logging off.`;
		}

		const { type, id } = request.ignore!;
		const before = getLogIgnores(guild.id)[type];
		const changed = request.sub === 'ignore' ? addLogIgnore(guild.id, type, id) : removeLogIgnore(guild.id, type, id);
		recordConfigChange(guild.id, actor, 'moderation', `log_ignore.${type}`, before.join(','), getLogIgnores(guild.id)[type].join(','));
		const mention = type === 'channel' ? `<#${id}>` : `<@${id}>`;
		if (request.sub === 'ignore') return changed ? `🙈 not logging ${mention} any more.` : `${mention} was already ignored.`;
		return changed ? `👀 logging ${mention} again.` : `${mention} wasn't ignored.`;
	}
}
