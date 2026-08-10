import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { Args, Command } from '@sapphire/framework';
import {
	getStarboardConfig,
	setStarboardChannel,
	setStarboardThreshold,
	setStarboardEmoji,
	setStarboardEnabled,
	setStarboardSelfStar,
	addToStarboardBlacklist,
	removeFromStarboardBlacklist,
	getStarboardBlacklist,
	deleteStarboardMessage,
	getStarboardMessages,
	getStarboardMessageByIndex
} from '../../lib/starboard';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { MessageFlags, EmbedBuilder, GuildMember, type Message, ChannelType } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'starboard',
	description: 'Manage the starboard system',
	subcommands: [
		{ name: 'set-channel', chatInputRun: 'chatInputSetChannel', messageRun: 'messageSetChannel' },
		{ name: 'set-threshold', chatInputRun: 'chatInputSetThreshold', messageRun: 'messageSetThreshold' },
		{ name: 'set-emoji', chatInputRun: 'chatInputSetEmoji', messageRun: 'messageSetEmoji' },
		{ name: 'self-star', chatInputRun: 'chatInputSelfStar', messageRun: 'messageSelfStar' },
		{ name: 'enable', chatInputRun: 'chatInputEnable', messageRun: 'messageEnable' },
		{ name: 'disable', chatInputRun: 'chatInputDisable', messageRun: 'messageDisable' },
		{ name: 'delete', chatInputRun: 'chatInputDelete', messageRun: 'messageDeleteEntry' },
		{ name: 'list', chatInputRun: 'chatInputList', messageRun: 'messageList' },
		{ name: 'config', chatInputRun: 'chatInputConfig', messageRun: 'messageConfig', default: true },
		{
			name: 'blacklist',
			type: 'group',
			entries: [
				{ name: 'add', chatInputRun: 'chatInputBlacklistAdd', messageRun: 'messageBlacklistAdd' },
				{ name: 'remove', chatInputRun: 'chatInputBlacklistRemove', messageRun: 'messageBlacklistRemove' },
				{ name: 'list', chatInputRun: 'chatInputBlacklistList', messageRun: 'messageBlacklistList' }
			]
		}
	]
})
export class StarboardCommand extends Subcommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('set-channel')
						.setDescription('Set the starboard channel')
						.addChannelOption((opt) => opt.setName('channel').setDescription('The channel to use for starboard').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('set-threshold')
						.setDescription('Set the star threshold')
						.addIntegerOption((opt) =>
							opt.setName('threshold').setDescription('Number of stars required').setRequired(true).setMinValue(1).setMaxValue(50)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('set-emoji')
						.setDescription('Set the emoji that triggers the starboard')
						.addStringOption((opt) => opt.setName('emoji').setDescription('The emoji to react with (default ⭐)').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('self-star')
						.setDescription('Allow or disallow users starring their own messages')
						.addStringOption((opt) =>
							opt
								.setName('state')
								.setDescription('on or off')
								.setRequired(true)
								.addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
						)
				)
				.addSubcommand((sub) => sub.setName('enable').setDescription('Enable the starboard'))
				.addSubcommand((sub) => sub.setName('disable').setDescription('Disable the starboard without losing its configuration'))
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a starboard entry')
						.addStringOption((opt) => opt.setName('index').setDescription('The index code of the entry').setRequired(true))
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List all starboard entries'))
				.addSubcommand((sub) => sub.setName('config').setDescription('Show starboard configuration'))
				.addSubcommandGroup((group) =>
					group
						.setName('blacklist')
						.setDescription('Manage the starboard blacklist')
						.addSubcommand((sub) =>
							sub
								.setName('add')
								.setDescription('Exclude a channel or user from the starboard')
								.addChannelOption((opt) => opt.setName('channel').setDescription('Channel to exclude').setRequired(false))
								.addUserOption((opt) => opt.setName('user').setDescription('User to exclude').setRequired(false))
						)
						.addSubcommand((sub) =>
							sub
								.setName('remove')
								.setDescription('Remove a channel or user from the starboard blacklist')
								.addChannelOption((opt) => opt.setName('channel').setDescription('Channel to remove').setRequired(false))
								.addUserOption((opt) => opt.setName('user').setDescription('User to remove').setRequired(false))
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('List blacklisted channels and users'))
				)
		);
	}

	private isAdmin(member: GuildMember | null) {
		if (!member) return false;
		return member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
	}

	// ---- Slash command handlers ----

	public async chatInputSetChannel(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const channel = interaction.options.getChannel('channel', true);
		if (channel.type !== ChannelType.GuildText) {
			return interaction.reply({ content: 'Please specify a text channel.', flags: MessageFlags.Ephemeral });
		}

		setStarboardChannel(interaction.guild.id, channel.id);
		return interaction.reply({ content: `✅ Starboard channel set to <#${channel.id}>`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputSetThreshold(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const threshold = interaction.options.getInteger('threshold', true);
		setStarboardThreshold(interaction.guild.id, threshold);
		return interaction.reply({ content: `✅ Starboard threshold set to ${threshold} stars.`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputSetEmoji(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const emoji = interaction.options.getString('emoji', true).trim();
		if (emoji.length === 0 || emoji.length > 64) {
			return interaction.reply({ content: '❌ Please provide a valid emoji.', flags: MessageFlags.Ephemeral });
		}

		setStarboardEmoji(interaction.guild.id, emoji);
		return interaction.reply({ content: `✅ Starboard emoji set to ${emoji}`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputSelfStar(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const state = interaction.options.getString('state', true) === 'on';
		setStarboardSelfStar(interaction.guild.id, state);
		return interaction.reply({ content: `✅ Self-starring: **${state ? 'on' : 'off'}**`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputEnable(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		setStarboardEnabled(interaction.guild.id, true);
		return interaction.reply({ content: '✅ Starboard enabled.', flags: MessageFlags.Ephemeral });
	}

	public async chatInputDisable(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		setStarboardEnabled(interaction.guild.id, false);
		return interaction.reply({ content: '✅ Starboard disabled. Configuration has been kept.', flags: MessageFlags.Ephemeral });
	}

	public async chatInputDelete(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const indexCode = interaction.options.getString('index', true).toUpperCase();
		return interaction.reply(await this.deleteEntry(interaction.guild.id, indexCode));
	}

	public async chatInputList(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });

		const starboardMessages = getStarboardMessages(interaction.guild.id);
		if (starboardMessages.length === 0) {
			return interaction.reply({ content: '📋 No starboard entries found for this server.', flags: MessageFlags.Ephemeral });
		}

		const paginatedMessage = this.buildListPaginatedMessage(starboardMessages);
		const response = await interaction.reply({ content: 'Loading starboard entries...', flags: MessageFlags.Ephemeral, fetchReply: true });
		await paginatedMessage.run(response, interaction.user);
		return response;
	}

	public async chatInputConfig(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		return interaction.reply({ embeds: [this.buildConfigEmbed(interaction.guild.id)], flags: MessageFlags.Ephemeral });
	}

	public async chatInputBlacklistAdd(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const channel = interaction.options.getChannel('channel', false);
		const user = interaction.options.getUser('user', false);
		if (!channel && !user) return interaction.reply({ content: 'Specify a channel or a user to blacklist.', flags: MessageFlags.Ephemeral });

		if (channel) addToStarboardBlacklist(interaction.guild.id, channel.id, 'channel');
		if (user) addToStarboardBlacklist(interaction.guild.id, user.id, 'user');

		return interaction.reply({
			content: `✅ Blacklisted ${channel ? `<#${channel.id}>` : ''}${channel && user ? ' and ' : ''}${user ? `<@${user.id}>` : ''} from the starboard.`,
			flags: MessageFlags.Ephemeral
		});
	}

	public async chatInputBlacklistRemove(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild())
			return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		if (!this.isAdmin(interaction.member))
			return interaction.reply({ content: 'You must be a server admin to use this.', flags: MessageFlags.Ephemeral });

		const channel = interaction.options.getChannel('channel', false);
		const user = interaction.options.getUser('user', false);
		if (!channel && !user) return interaction.reply({ content: 'Specify a channel or a user to remove.', flags: MessageFlags.Ephemeral });

		if (channel) removeFromStarboardBlacklist(interaction.guild.id, channel.id, 'channel');
		if (user) removeFromStarboardBlacklist(interaction.guild.id, user.id, 'user');

		return interaction.reply({ content: '✅ Removed from the starboard blacklist.', flags: MessageFlags.Ephemeral });
	}

	public async chatInputBlacklistList(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
		return interaction.reply({ content: this.formatBlacklist(interaction.guild.id), flags: MessageFlags.Ephemeral });
	}

	// ---- Message command handlers ----

	public async messageSetChannel(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		try {
			const channel = await args.pick('guildTextChannel');
			if (channel.type !== ChannelType.GuildText) return message.reply('Please specify a text channel.');
			setStarboardChannel(message.guild.id, channel.id);
			return message.reply(`✅ Starboard channel set to <#${channel.id}>`);
		} catch {
			return message.reply('Please specify a valid text channel. Usage: `starboard set-channel #channel`');
		}
	}

	public async messageSetThreshold(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		try {
			const threshold = await args.pick('integer');
			if (threshold < 1) return message.reply('The star threshold must be at least 1.');
			if (threshold > 50) return message.reply('The star threshold cannot be more than 50.');
			setStarboardThreshold(message.guild.id, threshold);
			return message.reply(`✅ Starboard threshold set to ${threshold} stars.`);
		} catch {
			return message.reply('Please specify a valid number. Usage: `starboard set-threshold <number>`');
		}
	}

	public async messageSetEmoji(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		try {
			const emoji = (await args.pick('string')).trim();
			if (emoji.length === 0 || emoji.length > 64) return message.reply('Please specify a valid emoji.');
			setStarboardEmoji(message.guild.id, emoji);
			return message.reply(`✅ Starboard emoji set to ${emoji}`);
		} catch {
			return message.reply('Please specify an emoji. Usage: `starboard set-emoji <emoji>`');
		}
	}

	public async messageSelfStar(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		const state = (await args.pick('string').catch(() => '')).toLowerCase();
		if (state !== 'on' && state !== 'off') return message.reply('Please specify `on` or `off`.');
		setStarboardSelfStar(message.guild.id, state === 'on');
		return message.reply(`✅ Self-starring: **${state}**`);
	}

	public async messageEnable(message: Message) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');
		setStarboardEnabled(message.guild.id, true);
		return message.reply('✅ Starboard enabled.');
	}

	public async messageDisable(message: Message) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');
		setStarboardEnabled(message.guild.id, false);
		return message.reply('✅ Starboard disabled. Configuration has been kept.');
	}

	public async messageDeleteEntry(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		try {
			const indexCode = (await args.pick('string')).toUpperCase();
			const result = await this.deleteEntry(message.guild.id, indexCode);
			return message.reply(result.content);
		} catch {
			return message.reply('Please specify a valid index code. Usage: `starboard delete <index>`');
		}
	}

	public async messageList(message: Message) {
		if (!message.guild) return message.reply('This command can only be used in a server.');

		const starboardMessages = getStarboardMessages(message.guild.id);
		if (starboardMessages.length === 0) return message.reply('📋 No starboard entries found for this server.');

		const paginatedMessage = this.buildListPaginatedMessage(starboardMessages);
		const response = await message.reply({ content: 'Loading starboard entries...' });
		await paginatedMessage.run(response, message.author);
		return response;
	}

	public async messageConfig(message: Message) {
		if (!message.guild) return message.reply('This command can only be used in a server.');
		return message.reply({ embeds: [this.buildConfigEmbed(message.guild.id)] });
	}

	public async messageBlacklistAdd(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		const channel = await args.pick('guildTextChannel').catch(() => null);
		const user = await args.pick('user').catch(() => null);
		if (!channel && !user) return message.reply('Specify a channel or a user to blacklist. Usage: `starboard blacklist add #channel|@user`');

		if (channel) addToStarboardBlacklist(message.guild.id, channel.id, 'channel');
		if (user) addToStarboardBlacklist(message.guild.id, user.id, 'user');
		return message.reply('✅ Added to the starboard blacklist.');
	}

	public async messageBlacklistRemove(message: Message, args: Args) {
		if (!message.guild || !message.member) return message.reply('This command can only be used in a server.');
		if (!this.isAdmin(message.member as GuildMember)) return message.reply('You must be a server admin to use this.');

		const channel = await args.pick('guildTextChannel').catch(() => null);
		const user = await args.pick('user').catch(() => null);
		if (!channel && !user) return message.reply('Specify a channel or a user to remove. Usage: `starboard blacklist remove #channel|@user`');

		if (channel) removeFromStarboardBlacklist(message.guild.id, channel.id, 'channel');
		if (user) removeFromStarboardBlacklist(message.guild.id, user.id, 'user');
		return message.reply('✅ Removed from the starboard blacklist.');
	}

	public async messageBlacklistList(message: Message) {
		if (!message.guild) return message.reply('This command can only be used in a server.');
		return message.reply(this.formatBlacklist(message.guild.id));
	}

	// ---- Shared helpers ----

	private async deleteEntry(guildId: string, indexCode: string) {
		const starboardMessage = getStarboardMessageByIndex(indexCode);
		if (!starboardMessage) return { content: `❌ No starboard entry found with index \`${indexCode}\`` };
		if (starboardMessage.guild_id !== guildId) return { content: '❌ That starboard entry is not from this server.' };

		const deleted = deleteStarboardMessage(indexCode);
		if (!deleted) return { content: `❌ Failed to delete starboard entry \`${indexCode}\`` };

		try {
			const config = getStarboardConfig(guildId);
			const guild = this.container.client.guilds.cache.get(guildId);
			if (config.channel_id && guild) {
				const starboardChannel = guild.channels.cache.get(config.channel_id);
				if (starboardChannel?.isTextBased()) {
					const starboardMsg = await starboardChannel.messages.fetch(starboardMessage.starboard_message_id).catch(() => null);
					await starboardMsg?.delete().catch(() => {});
				}
			}
		} catch {
			// Ignore errors when trying to delete the message
		}

		return { content: `✅ Deleted starboard entry \`${indexCode}\`` };
	}

	private buildListPaginatedMessage(starboardMessages: ReturnType<typeof getStarboardMessages>) {
		const paginatedMessage = new PaginatedMessage({
			template: new EmbedBuilder()
				.setColor('#FFD700')
				.setTitle('📋 Starboard Entries')
				.setFooter({ text: `${starboardMessages.length} total entries` })
		});

		const entriesPerPage = 10;
		for (let i = 0; i < starboardMessages.length; i += entriesPerPage) {
			const page = starboardMessages.slice(i, i + entriesPerPage);
			paginatedMessage.addPageEmbed((embed) =>
				embed.setDescription(
					page.map((entry) => `**${entry.index_code}** - ⭐ ${entry.star_count} - <#${entry.original_channel_id}>`).join('\n')
				)
			);
		}

		return paginatedMessage;
	}

	private buildConfigEmbed(guildId: string) {
		const config = getStarboardConfig(guildId);
		const blacklist = getStarboardBlacklist(guildId);
		return new EmbedBuilder()
			.setColor('#FFD700')
			.setTitle('⭐ Starboard Configuration')
			.addFields([
				{ name: 'Channel', value: config.channel_id ? `<#${config.channel_id}>` : 'Not set', inline: true },
				{ name: 'Threshold', value: config.threshold.toString(), inline: true },
				{ name: 'Emoji', value: config.emoji, inline: true },
				{ name: 'Self-star', value: config.self_star ? 'on' : 'off', inline: true },
				{ name: 'Blacklisted entries', value: blacklist.length.toString(), inline: true },
				{
					name: 'Status',
					value: !config.channel_id ? '❌ Inactive (no channel set)' : config.enabled ? '✅ Active' : '⏸️ Disabled',
					inline: true
				}
			])
			.setFooter({ text: 'Use /starboard set-channel, set-threshold, set-emoji, self-star, enable, disable to configure' });
	}

	private formatBlacklist(guildId: string) {
		const blacklist = getStarboardBlacklist(guildId);
		if (blacklist.length === 0) return '📋 No blacklisted channels or users.';
		return (
			'📋 **Starboard blacklist:**\n' +
			blacklist.map((entry) => (entry.target_type === 'channel' ? `<#${entry.target_id}>` : `<@${entry.target_id}>`)).join('\n')
		);
	}
}
