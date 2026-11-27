import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message } from 'discord.js';
import { ModError, actWithCase, auditReason, caseSuffix, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickOptional, restText, type ModContext } from '../../lib/modCommand';
import { lockChannel, lockServer, resolveLockable, summarize } from '../../lib/modLock';

@ApplyOptions<ModCommandOptions>({
	name: 'lock',
	description: 'Stop @everyone sending messages in a channel, or the whole server',
	permission: PermissionFlagsBits.ManageChannels,
	// Channel overwrites need Manage Roles ("Manage Permissions") on top of Manage Channels.
	clientPermission: PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles
})
export class LockCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addChannelOption((o) =>
					o
						.setName('channel')
						.setDescription('Which channel (default: this one)')
						.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice)
				)
				.addBooleanOption((o) => o.setName('server').setDescription('Lock every channel @everyone can talk in'))
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const server = interaction.options.getBoolean('server') ?? false;
		return respond(
			interaction,
			() =>
				this.execute(
					contextOf(interaction),
					server ? null : (interaction.options.getChannel('channel')?.id ?? interaction.channelId),
					interaction.options.getString('reason')
				),
			{ defer: server }
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const target = await pickOptional(args, (word) => (word.toLowerCase() === 'server' ? 'server' : snowflakeFrom(word)));
			const channelId = target === 'server' ? null : (target ?? message.channelId);
			return this.execute(contextOf(message), channelId, await restText(args));
		});
	}

	/** channelId null means the whole server. */
	private async execute({ guild, moderator }: ModContext, channelId: string | null, reason: string | null) {
		const audit = auditReason(moderator.user, reason);
		const base = { action: 'lock' as const, moderatorId: moderator.id, moderatorTag: moderator.user.username, reason };

		if (channelId === null) {
			let summary = '';
			const { modCase } = await actWithCase(guild, { ...base, targetType: 'guild', targetId: guild.id, targetTag: guild.name }, async () => {
				const result = await lockServer(guild, audit);
				if (result.changed.length === 0 && result.failed.length === 0)
					throw new ModError("no channels to lock: @everyone can't talk anywhere already.");
				summary = summarize(result);
			});
			return `🔒 locked ${summary}\n${caseSuffix(modCase)}`;
		}

		const channel = resolveLockable(guild, channelId);
		const { modCase } = await actWithCase(guild, { ...base, targetType: 'channel', targetId: channel.id, targetTag: channel.name }, () =>
			lockChannel(channel, audit)
		);
		return `🔒 locked <#${channel.id}>.\n${caseSuffix(modCase)}`;
	}
}
