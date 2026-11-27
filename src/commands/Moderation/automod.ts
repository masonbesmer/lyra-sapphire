import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, EmbedBuilder, Colors, PermissionFlagsBits, type Guild, type Message } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { auditAutomodRule } from '../../lib/modDashboard';
import {
	AUTOMOD_ACTIONS,
	AUTOMOD_RULES,
	MAX_LIST_ENTRIES,
	RULE_DESCRIPTIONS,
	RULE_LIMITS,
	RULE_LIST_KEY,
	checkContentRule,
	describeRuleSettings,
	getAutomodSettings,
	getRule,
	getRules,
	isAutomodAction,
	isAutomodRule,
	normaliseListEntry,
	saveAutomodSettings,
	updateRule,
	type AutomodAction,
	type AutomodRule,
	type RuleConfig
} from '../../lib/automod';
import { describeSyncReport, lyraNativeRules, syncNativeRules } from '../../lib/automodNative';
import { ModError, respond, snowflakeFrom, type ModReply } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';
import { MAX_SCHEDULED_MS, MAX_TIMEOUT_MS, formatDuration, parseDuration } from '../../lib/moderation';
import { phishingListSize } from '../../lib/phishing';

const LIST_RULES = AUTOMOD_RULES.filter((rule) => RULE_LIST_KEY[rule]);
const USAGE = [
	'`%automod view [filter]`',
	'`%automod configure <filter> [on|off] [action] [duration] [limit=N] [window=30s] [mode=allow|block]`',
	'`%automod list add|remove|show <filter> [value]`',
	'`%automod exempt add|remove <filter|all> <@role|#channel>`',
	'`%automod native on|off|status`',
	'`%automod test <text>`'
].join(' | ');

const ruleChoices = AUTOMOD_RULES.map((rule) => ({ name: rule, value: rule }));

interface ConfigureInput {
	rule: AutomodRule;
	enabled: boolean | null;
	action: AutomodAction | null;
	duration: string | null;
	limit: number | null;
	window: string | null;
	mode: 'allow' | 'block' | null;
}

@ApplyOptions<ModCommandOptions>({
	name: 'automod',
	description: 'AutoMod filters: words, links, spam, phishing and more',
	permission: PermissionFlagsBits.ManageGuild,
	// Deleting messages is the least every filter does; timeouts/kicks/bans are checked when they happen.
	clientPermission: PermissionFlagsBits.ManageMessages
})
export class AutomodCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) =>
					sub
						.setName('view')
						.setDescription('Show the AutoMod filters, or one filter in detail')
						.addStringOption((o) =>
							o
								.setName('filter')
								.setDescription('Which filter')
								.addChoices(...ruleChoices)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('configure')
						.setDescription('Turn a filter on/off and choose what it does')
						.addStringOption((o) =>
							o
								.setName('filter')
								.setDescription('Which filter')
								.setRequired(true)
								.addChoices(...ruleChoices)
						)
						.addBooleanOption((o) => o.setName('enabled').setDescription('Turn it on or off'))
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('What happens to the member')
								.addChoices(...AUTOMOD_ACTIONS.map((action) => ({ name: action, value: action })))
						)
						.addStringOption((o) =>
							o.setName('duration').setDescription('Timeout length (default 10m), or temp-ban length (e.g. 1h, 7d)')
						)
						.addIntegerOption((o) =>
							o
								.setName('limit')
								.setDescription('mentions/emoji: max per message · caps: % · zalgo: marks in a row · duplicates/flood: messages')
						)
						.addStringOption((o) => o.setName('window').setDescription('duplicates/flood: time window (e.g. 5s, 30s)'))
						.addStringOption((o) =>
							o
								.setName('link_mode')
								.setDescription('links: block the listed domains, or allow only them')
								.addChoices({ name: 'block listed domains', value: 'block' }, { name: 'allow only listed domains', value: 'allow' })
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('list')
						.setDescription('Words, invite codes, domains and file types the filters use')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Add an entry')
								.addStringOption((o) =>
									o
										.setName('filter')
										.setDescription('Which list')
										.setRequired(true)
										.addChoices(...LIST_RULES.map((rule) => ({ name: rule, value: rule })))
								)
								.addStringOption((o) =>
									o
										.setName('value')
										.setDescription('word (`*` wildcard), /regex/, invite code, domain or extension')
										.setRequired(true)
										.setMaxLength(200)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove an entry')
								.addStringOption((o) =>
									o
										.setName('filter')
										.setDescription('Which list')
										.setRequired(true)
										.addChoices(...LIST_RULES.map((rule) => ({ name: rule, value: rule })))
								)
								.addStringOption((o) => o.setName('value').setDescription('The entry to remove').setRequired(true).setMaxLength(200))
						)
						.addSubcommand((sub) =>
							sub
								.setName('show')
								.setDescription('Show a list')
								.addStringOption((o) =>
									o
										.setName('filter')
										.setDescription('Which list')
										.setRequired(true)
										.addChoices(...LIST_RULES.map((rule) => ({ name: rule, value: rule })))
								)
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('exempt')
						.setDescription('Roles and channels a filter (or all of AutoMod) ignores')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Exempt a role or channel')
								.addStringOption((o) =>
									o
										.setName('filter')
										.setDescription('Which filter, or all')
										.setRequired(true)
										.addChoices({ name: 'all filters', value: 'all' }, ...ruleChoices)
								)
								.addRoleOption((o) => o.setName('role').setDescription('Role to exempt'))
								.addChannelOption((o) =>
									o
										.setName('channel')
										.setDescription('Channel to exempt (covers its threads)')
										.addChannelTypes(
											ChannelType.GuildText,
											ChannelType.GuildAnnouncement,
											ChannelType.GuildForum,
											ChannelType.GuildVoice
										)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Stop exempting a role or channel')
								.addStringOption((o) =>
									o
										.setName('filter')
										.setDescription('Which filter, or all')
										.setRequired(true)
										.addChoices({ name: 'all filters', value: 'all' }, ...ruleChoices)
								)
								.addRoleOption((o) => o.setName('role').setDescription('Role'))
								.addChannelOption((o) => o.setName('channel').setDescription('Channel'))
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('native')
						.setDescription("Mirror words, mention spam and spam into Discord's own AutoMod (blocks before anyone sees it)")
						.addStringOption((o) =>
							o
								.setName('state')
								.setDescription('on, off, or show what is synced')
								.setRequired(true)
								.addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }, { name: 'status', value: 'status' })
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('test')
						.setDescription('Check some text against the content filters (nothing is actioned)')
						.addStringOption((o) => o.setName('text').setDescription('Text to check').setRequired(true).setMaxLength(2000))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const options = interaction.options;
		const group = options.getSubcommandGroup(false);
		const sub = options.getSubcommand(true);
		return respond(
			interaction,
			() => {
				const ctx = contextOf(interaction);
				const filter = options.getString('filter');
				if (group === 'list') return this.list(ctx, sub, filter ?? '', options.getString('value'));
				if (group === 'exempt')
					return this.exempt(ctx, sub, filter ?? '', options.getRole('role')?.id ?? null, options.getChannel('channel')?.id ?? null);
				if (sub === 'view') return this.view(ctx, filter);
				if (sub === 'native') return this.native(ctx, options.getString('state', true));
				if (sub === 'test') return this.test(ctx, options.getString('text', true));
				return this.configure(ctx, {
					rule: this.ruleOf(filter ?? ''),
					enabled: options.getBoolean('enabled'),
					action: (options.getString('action') as AutomodAction | null) ?? null,
					duration: options.getString('duration'),
					limit: options.getInteger('limit'),
					window: options.getString('window'),
					mode: (options.getString('link_mode') as 'allow' | 'block' | null) ?? null
				});
			},
			// Native sync talks to Discord a few times; view/test are only for the moderator.
			{ defer: sub === 'native' || group !== null || sub === 'configure', ephemeral: sub === 'test' }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const ctx = contextOf(message);
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			if (sub === 'view') return this.view(ctx, await args.pick('string').catch(() => null));
			if (sub === 'test') {
				const text = await args.rest('string').catch(() => '');
				if (!text) usage('`%automod test <text>`');
				return this.test(ctx, text);
			}
			if (sub === 'native') return this.native(ctx, (await args.pick('string').catch(() => '')).toLowerCase());
			if (sub === 'list') {
				const action = (await args.pick('string').catch(() => '')).toLowerCase();
				const filter = (await args.pick('string').catch(() => '')).toLowerCase();
				const value = await args.rest('string').catch(() => null);
				return this.list(ctx, action, filter, value);
			}
			if (sub === 'exempt') {
				const action = (await args.pick('string').catch(() => '')).toLowerCase();
				const filter = (await args.pick('string').catch(() => '')).toLowerCase();
				const target = await args.pick('string').catch(() => '');
				const id = snowflakeFrom(target);
				if (!id) usage('`%automod exempt add|remove <filter|all> <@role|#channel>`');
				const isRole = target.startsWith('<@&') || ctx.guild.roles.cache.has(id);
				return this.exempt(ctx, action, filter, isRole ? id : null, isRole ? null : id);
			}
			if (sub === 'configure') {
				const rule = this.ruleOf((await args.pick('string').catch(() => '')).toLowerCase());
				const input: ConfigureInput = { rule, enabled: null, action: null, duration: null, limit: null, window: null, mode: null };
				const words = (await args.rest('string').catch(() => '')).split(/\s+/).filter(Boolean);
				for (const word of words.map((entry) => entry.toLowerCase())) {
					if (word === 'on' || word === 'off') input.enabled = word === 'on';
					else if (isAutomodAction(word)) input.action = word;
					else if (word.startsWith('limit=')) input.limit = Number(word.slice(6));
					else if (word.startsWith('window=')) input.window = word.slice(7);
					else if (word.startsWith('mode=') && (word === 'mode=allow' || word === 'mode=block'))
						input.mode = word.slice(5) as 'allow' | 'block';
					else if (parseDuration(word) !== null) input.duration = word;
					else throw new ModError(`I don't understand "${word}". ${USAGE}`);
				}
				return this.configure(ctx, input);
			}
			return usage(USAGE);
		});
	}

	private ruleOf(name: string): AutomodRule {
		if (!isAutomodRule(name)) throw new ModError(`pick a filter: ${AUTOMOD_RULES.join(', ')}.`);
		return name;
	}

	private async view({ guild }: ModContext, filter: string | null): Promise<ModReply> {
		const settings = getAutomodSettings(guild.id);
		if (filter) {
			const config = getRule(guild.id, this.ruleOf(filter.toLowerCase()));
			const embed = new EmbedBuilder()
				.setColor(config.enabled ? Colors.Green : Colors.Grey)
				.setTitle(`AutoMod: ${config.rule} (${config.enabled ? 'on' : 'off'})`)
				.setDescription(RULE_DESCRIPTIONS[config.rule])
				.addFields(
					{ name: 'Action', value: describeAction(config), inline: true },
					{ name: 'Settings', value: describeRuleSettings(config) || '—', inline: true },
					{ name: 'Exempt roles', value: config.exemptRoles.map((id) => `<@&${id}>`).join(' ') || '—' },
					{ name: 'Exempt channels', value: config.exemptChannels.map((id) => `<#${id}>`).join(' ') || '—' }
				);
			if (config.rule === 'phishing') embed.addFields({ name: 'Shared list', value: `${phishingListSize()} known domains loaded` });
			return { embeds: [embed] };
		}
		const lines = getRules(guild.id).map(
			(config) =>
				`${config.enabled ? '🟢' : '⚫'} **${config.rule}** — ${describeAction(config)}${config.enabled ? ` · ${describeRuleSettings(config)}` : ''}`
		);
		const embed = new EmbedBuilder()
			.setColor(Colors.Blurple)
			.setTitle('AutoMod')
			.setDescription(lines.join('\n'))
			.addFields(
				{ name: 'Native Discord AutoMod sync', value: settings.nativeSync ? 'on' : 'off', inline: true },
				{
					name: 'Exempt everywhere',
					value: [...settings.exemptRoles.map((id) => `<@&${id}>`), ...settings.exemptChannels.map((id) => `<#${id}>`)].join(' ') || '—',
					inline: true
				}
			)
			.setFooter({ text: 'Owners and administrators are never filtered. Actions go to the mod-log channel.' });
		return { embeds: [embed] };
	}

	private async configure({ guild, moderator }: ModContext, input: ConfigureInput): Promise<ModReply> {
		const { rule } = input;
		const limits = RULE_LIMITS[rule];
		let durationMs: number | null | undefined;
		if (input.duration !== null) {
			durationMs = parseDuration(input.duration);
			if (!durationMs) throw new ModError(`"${input.duration}" isn't a duration I understand. try \`10m\`, \`1h\` or \`7d\`.`);
		}
		if (input.limit !== null) {
			if (!limits) throw new ModError(`the ${rule} filter has no limit to set.`);
			const [min, max] = limits.limit;
			if (!Number.isInteger(input.limit) || input.limit < min || input.limit > max)
				throw new ModError(`the ${rule} limit must be ${min}–${max}.`);
		}
		let windowMs: number | null = null;
		if (input.window !== null) {
			if (!limits?.window) throw new ModError(`only duplicates and flood have a time window.`);
			windowMs = parseDuration(input.window);
			const [min, max] = limits.window;
			if (!windowMs || windowMs < min || windowMs > max)
				throw new ModError(`the ${rule} window must be ${formatDuration(min)}–${formatDuration(max)}.`);
		}
		if (input.mode !== null && rule !== 'links') throw new ModError('link_mode only applies to the links filter.');

		const before = getRule(guild.id, rule);
		const nextAction = input.action ?? before.action;
		const nextDuration = durationMs !== undefined ? durationMs : before.durationMs;
		if (nextAction === 'timeout' && nextDuration && nextDuration > MAX_TIMEOUT_MS) throw new ModError('Discord caps timeouts at 28 days.');
		if (nextDuration && nextDuration > MAX_SCHEDULED_MS) throw new ModError('durations are capped at a year.');
		const after = updateRule(guild.id, rule, (config) => {
			if (input.enabled !== null) config.enabled = input.enabled;
			config.action = nextAction;
			config.durationMs = nextDuration;
			if (input.limit !== null) config.settings.limit = input.limit;
			if (windowMs !== null) config.settings.windowMs = windowMs;
			if (input.mode !== null) config.settings.mode = input.mode;
		});

		const actor = auditActor(moderator, 'discord');
		auditAutomodRule(guild.id, actor, before, after);
		const sync = await this.resync(guild);
		const warn = after.enabled && after.rule === 'links' && after.settings.mode === 'allow' && !(after.settings.domains ?? []).length;
		return [
			`🛡️ **${rule}** is ${after.enabled ? 'on' : 'off'} · ${describeAction(after)} · ${describeRuleSettings(after) || 'no settings'}`,
			warn ? '-# ⚠️ the allowlist is empty, so every link is blocked. add domains with `/automod list add`.' : null,
			sync
		]
			.filter(Boolean)
			.join('\n');
	}

	private async list({ guild, moderator }: ModContext, action: string, filter: string, value: string | null): Promise<ModReply> {
		const rule = this.ruleOf(filter);
		const key = RULE_LIST_KEY[rule];
		if (!key) throw new ModError(`the ${rule} filter has no list. lists: ${LIST_RULES.join(', ')}.`);
		const current = (getRule(guild.id, rule).settings[key] as string[] | undefined) ?? [];
		if (action === 'show') {
			if (!current.length) return `📃 the ${rule} list is empty.`;
			const shown = current.map((entry) => `\`${entry.replace(/`/g, 'ˋ')}\``).join(', ');
			return `📃 **${rule}** (${current.length}): ${shown.length > 1800 ? `${shown.slice(0, 1800)}…` : shown}`;
		}
		if (action !== 'add' && action !== 'remove') return usage('`%automod list add|remove|show <filter> [value]`');
		if (!value?.trim()) throw new ModError('give me something to add or remove.');
		const normalised = normaliseListEntry(rule, value);
		if ('error' in normalised) throw new ModError(normalised.error);
		const entry = normalised.value;

		if (action === 'add') {
			if (current.includes(entry)) return `📃 \`${entry}\` is already on the ${rule} list.`;
			if (current.length >= MAX_LIST_ENTRIES) throw new ModError(`lists are capped at ${MAX_LIST_ENTRIES} entries.`);
		} else if (!current.includes(entry)) {
			throw new ModError(`\`${entry}\` isn't on the ${rule} list.`);
		}
		const next = action === 'add' ? [...current, entry] : current.filter((item) => item !== entry);
		updateRule(guild.id, rule, (config) => {
			(config.settings as Record<string, unknown>)[key] = next;
		});
		recordConfigChange(guild.id, auditActor(moderator, 'discord'), 'moderation', `automod.${rule}.${key}`, current.join(', '), next.join(', '));
		const sync = rule === 'words' ? await this.resync(guild) : null;
		const enabled = getRule(guild.id, rule).enabled;
		return [
			`📃 ${action === 'add' ? 'added' : 'removed'} \`${entry}\` ${action === 'add' ? 'to' : 'from'} the ${rule} list (${next.length} entries).`,
			enabled ? null : `-# the ${rule} filter is off; turn it on with \`/automod configure filter:${rule} enabled:true\`.`,
			sync
		]
			.filter(Boolean)
			.join('\n');
	}

	private async exempt({ guild, moderator }: ModContext, action: string, filter: string, roleId: string | null, channelId: string | null) {
		if (action !== 'add' && action !== 'remove') return usage('`%automod exempt add|remove <filter|all> <@role|#channel>`');
		if (!roleId && !channelId) throw new ModError('pick a role or a channel.');
		const apply = (list: string[], id: string | null) => {
			if (!id) return list;
			return action === 'add' ? [...new Set([...list, id])] : list.filter((entry) => entry !== id);
		};
		const actor = auditActor(moderator, 'discord');
		if (filter === 'all') {
			const before = getAutomodSettings(guild.id);
			const after = { ...before, exemptRoles: apply(before.exemptRoles, roleId), exemptChannels: apply(before.exemptChannels, channelId) };
			saveAutomodSettings(guild.id, after);
			recordConfigChange(guild.id, actor, 'moderation', 'automod.exempt_roles', before.exemptRoles.join(','), after.exemptRoles.join(','));
			recordConfigChange(
				guild.id,
				actor,
				'moderation',
				'automod.exempt_channels',
				before.exemptChannels.join(','),
				after.exemptChannels.join(',')
			);
		} else {
			const rule = this.ruleOf(filter);
			const before = getRule(guild.id, rule);
			const after = updateRule(guild.id, rule, (config) => {
				config.exemptRoles = apply(config.exemptRoles, roleId);
				config.exemptChannels = apply(config.exemptChannels, channelId);
			});
			auditAutomodRule(guild.id, actor, before, after);
		}
		const target = [roleId ? `<@&${roleId}>` : null, channelId ? `<#${channelId}>` : null].filter(Boolean).join(' and ');
		const sync = await this.resync(guild);
		const scope = filter === 'all' ? 'all of AutoMod' : `the ${filter} filter`;
		return [`🛡️ ${target} ${action === 'add' ? 'is now exempt from' : 'is no longer exempt from'} ${scope}.`, sync].filter(Boolean).join('\n');
	}

	private async native({ guild, moderator }: ModContext, state: string): Promise<ModReply> {
		const settings = getAutomodSettings(guild.id);
		if (state === 'status') {
			const ours = await lyraNativeRules(guild);
			const rules = [...ours.values()].map((rule) => `• ${rule.name} (${rule.enabled ? 'enabled' : 'disabled'})`);
			return [
				`🛰️ native sync is **${settings.nativeSync ? 'on' : 'off'}**.`,
				rules.length ? rules.join('\n') : '-# Lyra has no native rules here.'
			].join('\n');
		}
		if (state !== 'on' && state !== 'off') return usage('`%automod native on|off|status`');
		const me = guild.members.me ?? (await guild.members.fetchMe());
		if (!me.permissions.has(PermissionFlagsBits.ManageGuild))
			throw new ModError('I need the **Manage Server** permission to manage native AutoMod rules.');
		saveAutomodSettings(guild.id, { ...settings, nativeSync: state === 'on' });
		recordConfigChange(guild.id, auditActor(moderator, 'discord'), 'moderation', 'automod.native_sync', settings.nativeSync, state === 'on');
		const report = await syncNativeRules(guild, { remove: state === 'off', reason: `${moderator.user.username}: /automod native ${state}` });
		return `🛰️ native sync is **${state}**.\n${describeSyncReport(report)}`;
	}

	private async test({ guild }: ModContext, text: string): Promise<ModReply> {
		const data = {
			content: text,
			mentionCount: (text.match(/<@[!&]?\d{17,20}>/g) ?? []).length + (/@(everyone|here)/.test(text) ? 1 : 0),
			attachmentNames: []
		};
		const results = getRules(guild.id)
			.filter((config) => config.rule !== 'duplicates' && config.rule !== 'flood' && config.rule !== 'attachments')
			.map((config) => ({ config, violation: checkContentRule(config, data) }))
			.filter((entry) => entry.violation);
		if (!results.length) return '✅ no content filter matches that text.';
		return results
			.map(
				({ config, violation }) =>
					`${config.enabled ? '🚫' : '⚫'} **${config.rule}**: ${violation!.detail}${config.enabled ? ` → ${describeAction(config)}` : ' (filter is off)'}`
			)
			.join('\n');
	}

	/** Re-mirrors into native AutoMod if that's on. Returns a line for the reply when something went wrong. */
	private async resync(guild: Guild): Promise<string | null> {
		if (!getAutomodSettings(guild.id).nativeSync) return null;
		try {
			const report = await syncNativeRules(guild);
			if (!report.failed.length && !report.skipped.length) return null;
			return `-# native AutoMod: ${describeSyncReport(report)}`;
		} catch (error) {
			return `-# ⚠️ couldn't update native AutoMod: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

function describeAction(config: RuleConfig): string {
	if (config.action === 'timeout') return `timeout ${formatDuration(config.durationMs ?? 600_000)}`;
	if (config.action === 'ban') return config.durationMs ? `ban ${formatDuration(config.durationMs)}` : 'ban';
	if (config.action === 'log') return 'log only';
	return config.action;
}
