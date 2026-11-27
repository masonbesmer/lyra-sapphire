import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import {
	JOIN_ACTIONS,
	VERIFY_MODES,
	getAntiRaidConfig,
	isVerifyMode,
	updateAntiRaidConfig,
	validateSettings,
	type AntiRaidConfig,
	type AntiRaidSettings,
	type VerifyMode
} from '../../lib/antiRaid';
import { ANTIRAID_USAGE as USAGE, CLEAR_COLUMN, CLEARABLE, describeAntiRaid, duration, joinAction, parseSetPairs } from '../../lib/antiRaidCommand';
import { endRaidMode, verifyPanelPayload } from '../../lib/antiRaidActions';
import { auditActor, recordConfigDiff } from '../../lib/audit';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';

const ACTION_CHOICES = JOIN_ACTIONS.map((action) => ({ name: action, value: action }));

/** /antiraid (LYRA-12): join-rate lockdown, new-member screening and the verification gate. */
@ApplyOptions<ModCommandOptions>({
	name: 'antiraid',
	description: 'Anti-raid: join-rate lockdown, new-member screening, verification',
	permission: PermissionFlagsBits.ManageGuild,
	clientPermission: 0n
})
export class AntiraidCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show the anti-raid settings and whether raid mode is on'))
				.addSubcommand((sub) => sub.setName('end').setDescription('End raid mode now and unlock what it locked'))
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription('Change anti-raid settings (only the options you give change)')
						.addBooleanOption((o) => o.setName('enabled').setDescription('Turn anti-raid on or off'))
						.addIntegerOption((o) =>
							o.setName('join_threshold').setDescription('Joins that count as a raid (3-100)').setMinValue(3).setMaxValue(100)
						)
						.addStringOption((o) => o.setName('join_window').setDescription('…within this long, e.g. 10s (5s-10m)'))
						.addBooleanOption((o) => o.setName('lockdown').setDescription('Lock the server when a raid starts'))
						.addStringOption((o) =>
							o
								.setName('raid_action')
								.setDescription('What happens to members joining during raid mode')
								.addChoices(...ACTION_CHOICES)
						)
						.addStringOption((o) => o.setName('raid_duration').setDescription('How long raid mode lasts, e.g. 15m (1m-24h)'))
						.addChannelOption((o) =>
							o
								.setName('alert_channel')
								.setDescription('Where alerts go (default: mod-log channel)')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						)
						.addRoleOption((o) => o.setName('alert_role').setDescription('Role pinged when a raid starts'))
						.addStringOption((o) => o.setName('min_account_age').setDescription('Minimum account age, e.g. 3d (off to disable)'))
						.addStringOption((o) =>
							o
								.setName('account_age_action')
								.setDescription('What happens to accounts that are too new')
								.addChoices(...ACTION_CHOICES)
						)
						.addStringOption((o) =>
							o
								.setName('default_avatar_action')
								.setDescription('What happens to members with no profile picture')
								.addChoices(...ACTION_CHOICES)
						)
						.addRoleOption((o) => o.setName('quarantine_role').setDescription('Role that restricts quarantined members'))
						.addBooleanOption((o) => o.setName('quarantine_on_join').setDescription('Quarantine every new member until they verify'))
						.addStringOption((o) =>
							o
								.setName('clear')
								.setDescription('Unset a channel or role')
								.addChoices(...CLEARABLE.map((name) => ({ name, value: name })))
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('verification')
						.setDescription('Post the verification button and choose what it grants')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Where to post the button')
								.setRequired(true)
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						)
						.addRoleOption((o) => o.setName('role').setDescription('Role granted on verifying (verifying also lifts quarantine)'))
						.addStringOption((o) =>
							o
								.setName('mode')
								.setDescription('Just a button, or a typed code')
								.addChoices(...VERIFY_MODES.map((mode) => ({ name: mode, value: mode })))
						)
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => {
			const context = contextOf(interaction);
			const sub = interaction.options.getSubcommand(true);
			const o = interaction.options;
			if (sub === 'verification') {
				const mode = o.getString('mode');
				return this.verification(
					context,
					o.getChannel('channel', true).id,
					o.getRole('role')?.id ?? null,
					mode && isVerifyMode(mode) ? mode : null
				);
			}
			if (sub !== 'set') return this.execute(context, sub, {});
			const settings: AntiRaidSettings = {
				enabled: o.getBoolean('enabled') ?? undefined,
				join_threshold: o.getInteger('join_threshold') ?? undefined,
				join_window_ms: o.getString('join_window') ? duration(o.getString('join_window')!, 'join_window') : undefined,
				raid_lockdown: o.getBoolean('lockdown') ?? undefined,
				raid_join_action: o.getString('raid_action') ? joinAction(o.getString('raid_action')!, 'raid_action') : undefined,
				raid_duration_ms: o.getString('raid_duration') ? duration(o.getString('raid_duration')!, 'raid_duration') : undefined,
				alert_channel_id: o.getChannel('alert_channel')?.id,
				alert_role_id: o.getRole('alert_role')?.id,
				min_account_age_ms: o.getString('min_account_age')
					? /^(off|0)$/i.test(o.getString('min_account_age')!)
						? 0
						: duration(o.getString('min_account_age')!, 'min_account_age')
					: undefined,
				account_age_action: o.getString('account_age_action')
					? joinAction(o.getString('account_age_action')!, 'account_age_action')
					: undefined,
				default_avatar_action: o.getString('default_avatar_action')
					? joinAction(o.getString('default_avatar_action')!, 'default_avatar_action')
					: undefined,
				quarantine_role_id: o.getRole('quarantine_role')?.id,
				quarantine_on_join: o.getBoolean('quarantine_on_join') ?? undefined
			};
			const clear = o.getString('clear') as (typeof CLEARABLE)[number] | null;
			if (clear && CLEAR_COLUMN[clear]) (settings as Record<string, unknown>)[CLEAR_COLUMN[clear]] = null;
			return this.execute(context, sub, settings);
		});
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const context = contextOf(message);
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			const words = (await args.repeat('string').catch(() => [] as string[])).filter(Boolean);
			if (sub === 'view' || sub === 'end') return this.execute(context, sub, {});
			if (sub === 'set') return this.execute(context, sub, parseSetPairs(words));
			if (sub === 'verification') {
				const channelId = snowflakeFrom(words[0]);
				if (!channelId) usage(USAGE);
				const mode = words.find((word) => isVerifyMode(word.toLowerCase()))?.toLowerCase() as VerifyMode | undefined;
				const roleWord = words.slice(1).find((word) => snowflakeFrom(word));
				return this.verification(context, channelId, roleWord ? snowflakeFrom(roleWord) : null, mode ?? null);
			}
			return usage(USAGE);
		});
	}

	private async execute({ guild, moderator }: ModContext, sub: string, settings: AntiRaidSettings) {
		if (sub === 'view') return describeAntiRaid(getAntiRaidConfig(guild.id));
		if (sub === 'end') return endRaidMode(guild, moderator.id);

		const before = getAntiRaidConfig(guild.id);
		const defined = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as AntiRaidSettings;
		if (!Object.keys(defined).length) throw new ModError('give at least one setting to change.');
		for (const key of ['alert_channel_id', 'alert_role_id', 'quarantine_role_id'] as const) {
			const id = defined[key];
			if (!id) continue;
			if (key === 'alert_channel_id' && !guild.channels.cache.get(id)?.isSendable()) throw new ModError(`I can't post in <#${id}>.`);
			if (key !== 'alert_channel_id' && !guild.roles.cache.has(id)) throw new ModError("that role doesn't exist here.");
		}
		const problem = validateSettings({ ...before, ...defined });
		if (problem) throw new ModError(problem);
		const after = updateAntiRaidConfig(guild.id, defined);
		recordConfigDiff(guild.id, auditActor(moderator, 'discord'), 'moderation', settingsSnapshot(before), settingsSnapshot(after));
		return `🛡️ saved.\n${describeAntiRaid(after)}`;
	}

	private async verification({ guild, moderator }: ModContext, channelId: string, roleId: string | null, mode: VerifyMode | null) {
		const before = getAntiRaidConfig(guild.id);
		const channel = guild.channels.cache.get(channelId);
		if (!channel?.isSendable() || channel.isDMBased()) throw new ModError("I can't post in that channel.");
		if (roleId) {
			const role = guild.roles.cache.get(roleId);
			if (!role) throw new ModError("that role doesn't exist here.");
			const me = guild.members.me;
			if (role.managed || role.id === guild.id) throw new ModError("I can't hand out that role.");
			if (me && role.position >= me.roles.highest.position)
				throw new ModError('that role is equal to or above my top role, so Discord won’t let me give it out.');
		}
		const verifyRole = roleId ?? before.verify_role_id;
		if (!verifyRole && !before.quarantine_role_id)
			throw new ModError('give a role to grant, or set a quarantine role first (verifying removes it).');
		const after = updateAntiRaidConfig(guild.id, { verify_role_id: verifyRole, verify_mode: mode ?? before.verify_mode });
		recordConfigDiff(guild.id, auditActor(moderator, 'discord'), 'moderation', settingsSnapshot(before), settingsSnapshot(after));
		await channel.send(verifyPanelPayload(guild.name, after.verify_mode));
		return `✅ posted the verification button in <#${channel.id}> (${after.verify_mode}${after.verify_role_id ? `, grants <@&${after.verify_role_id}>` : ''}${after.quarantine_role_id ? `, lifts <@&${after.quarantine_role_id}>` : ''}).`;
	}
}

/** Only the settings, prefixed, for the audit diff (raid state changes aren't config changes). */
function settingsSnapshot(config: AntiRaidConfig): Record<string, unknown> {
	const { guild_id: _guild, raid_until: _until, raid_locked: _locked, raid_join_count: _count, ...settings } = config;
	return Object.fromEntries(Object.entries(settings).map(([key, value]) => [`antiraid.${key}`, value]));
}
