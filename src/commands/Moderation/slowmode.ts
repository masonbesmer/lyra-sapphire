import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import { ModError, actWithCase, auditReason, caseSuffix, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickOptional, restText, usage, type ModContext } from '../../lib/modCommand';
import { MAX_SLOWMODE_SECONDS, formatDuration, parseDuration } from '../../lib/moderation';

/** `off`/`0` → 0 seconds, otherwise a duration. null when it's neither. */
function parseSlowmode(text: string): number | null {
	if (text === 'off' || text === '0') return 0;
	const ms = parseDuration(text);
	return ms === null ? null : Math.round(ms / 1000);
}

@ApplyOptions<ModCommandOptions>({
	name: 'slowmode',
	description: 'Set or clear slowmode on a channel',
	permission: PermissionFlagsBits.ManageChannels
})
export class SlowmodeCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addStringOption((o) =>
					o.setName('duration').setDescription('Delay between messages, e.g. 5s, 1m, 2h (max 6h), or off').setRequired(true)
				)
				.addChannelOption((o) =>
					o
						.setName('channel')
						.setDescription('Which channel (default: this one)')
						.addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum, ChannelType.GuildStageVoice)
				)
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () =>
			this.execute(
				contextOf(interaction),
				interaction.options.getChannel('channel')?.id ?? interaction.channelId,
				interaction.options.getString('duration', true),
				interaction.options.getString('reason')
			)
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const channelId = (await pickOptional(args, snowflakeFrom)) ?? message.channelId;
			const duration = await args.pick('string').catch(() => null);
			if (!duration) usage('`%slowmode [#channel] <duration|off> [reason]`');
			return this.execute(contextOf(message), channelId, duration, await restText(args));
		});
	}

	private async execute({ guild, moderator }: ModContext, channelId: string, durationText: string, reason: string | null) {
		const seconds = parseSlowmode(durationText.toLowerCase());
		if (seconds === null) throw new ModError(`"${durationText}" isn't a duration I understand. try \`5s\`, \`1m\` or \`off\`.`);
		if (seconds > MAX_SLOWMODE_SECONDS) throw new ModError('Discord caps slowmode at 6 hours.');
		const channel = guild.channels.cache.get(channelId);
		if (!channel || !('setRateLimitPerUser' in channel)) throw new ModError("that channel doesn't support slowmode.");

		const { modCase } = await actWithCase(
			guild,
			{
				action: 'slowmode',
				targetType: 'channel',
				targetId: channel.id,
				targetTag: channel.name,
				moderatorId: moderator.id,
				moderatorTag: moderator.user.username,
				reason,
				// Not an expiry: slowmode stays until changed. Recorded as the setting itself.
				durationMs: seconds > 0 ? seconds * 1000 : null,
				expiresAt: null
			},
			() => channel.setRateLimitPerUser(seconds, auditReason(moderator.user, reason)),
			{ extra: [{ name: 'Slowmode', value: seconds > 0 ? formatDuration(seconds * 1000) : 'off' }] }
		);
		return `${seconds > 0 ? `🐢 slowmode in <#${channel.id}> is **${formatDuration(seconds * 1000)}** now.` : `🐇 slowmode's off in <#${channel.id}>.`}\n${caseSuffix(modCase)}`;
	}
}
