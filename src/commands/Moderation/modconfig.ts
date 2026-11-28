import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';
import { DM_ACTIONS, getModConfig, isDmAction, setDmOnAction, setModLogChannel } from '../../lib/moderation';

const USAGE = '`%modconfig view` | `%modconfig log-channel [#channel|clear]` | `%modconfig dm <action> <on|off>`';

@ApplyOptions<ModCommandOptions>({
	name: 'modconfig',
	description: 'Moderation settings: mod-log channel and DMs on action',
	permission: PermissionFlagsBits.ManageGuild,
	// The bot needs nothing special to store settings.
	clientPermission: 0n
})
export class ModconfigCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show the moderation settings'))
				.addSubcommand((sub) =>
					sub
						.setName('log-channel')
						.setDescription('Where moderation actions get logged (omit to turn the log off)')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('The mod-log channel')
								.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('dm')
						.setDescription('Whether members get a DM when an action is taken against them')
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Which action')
								.setRequired(true)
								.addChoices(...DM_ACTIONS.map((action) => ({ name: action, value: action })))
						)
						.addBooleanOption((o) => o.setName('enabled').setDescription('Send the DM?').setRequired(true))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(
				contextOf(interaction),
				interaction.options.getSubcommand(true),
				interaction.options.getChannel('channel')?.id ?? null,
				interaction.options.getString('action'),
				interaction.options.getBoolean('enabled')
			)
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			if (sub === 'view') return this.execute(contextOf(message), sub, null, null, null);
			if (sub === 'log-channel') {
				const word = await args.pick('string').catch(() => null);
				if (word !== null && word !== 'clear' && !snowflakeFrom(word)) usage(USAGE);
				return this.execute(contextOf(message), sub, word === null || word === 'clear' ? null : snowflakeFrom(word), null, null);
			}
			if (sub === 'dm') {
				const action = (await args.pick('string').catch(() => '')).toLowerCase();
				const state = (await args.pick('string').catch(() => '')).toLowerCase();
				if (state !== 'on' && state !== 'off') usage(USAGE);
				return this.execute(contextOf(message), sub, null, action, state === 'on');
			}
			return usage(USAGE);
		});
	}

	private async execute({ guild, moderator }: ModContext, sub: string, channelId: string | null, action: string | null, enabled: boolean | null) {
		const actor = auditActor(moderator, 'discord');
		const before = getModConfig(guild.id);

		if (sub === 'view') {
			return [
				'**Moderation settings:**',
				`log_channel=${before.log_channel_id ? `<#${before.log_channel_id}>` : 'None (actions are not logged to a channel)'}`,
				`dm_on=${before.dm_actions.length ? before.dm_actions.join(', ') : 'nothing'}`
			].join('\n');
		}

		if (sub === 'log-channel') {
			if (channelId) {
				const channel = guild.channels.cache.get(channelId);
				if (!channel?.isSendable()) throw new ModError("I can't post in that channel.");
			}
			setModLogChannel(guild.id, channelId);
			recordConfigChange(guild.id, actor, 'moderation', 'log_channel_id', before.log_channel_id, channelId);
			return channelId ? `📋 mod actions get logged to <#${channelId}> now.` : '📋 mod log is off.';
		}

		if (!action || !isDmAction(action)) throw new ModError(`pick one of: ${DM_ACTIONS.join(', ')}.`);
		setDmOnAction(guild.id, action, enabled === true);
		recordConfigChange(guild.id, actor, 'moderation', 'dm_actions', before.dm_actions.join(','), getModConfig(guild.id).dm_actions.join(','));
		return `✉️ ${action}: ${enabled ? 'members get a DM' : 'no DM'}.`;
	}
}
