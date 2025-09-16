import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { Args } from '@sapphire/framework';
import {
	getStarboardConfig,
	setStarboardChannel,
	setStarboardThreshold,
	deleteStarboardMessage,
	getStarboardMessages,
	getStarboardMessageByIndex
} from '../../lib/starboard';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { EmbedBuilder, type Message, ChannelType } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'starboard',
	description: 'Manage the starboard system',
	subcommands: [
		{ name: 'set-channel', messageRun: 'messageSetChannel' },
		{ name: 'set-threshold', messageRun: 'messageSetThreshold' },
		{ name: 'delete', messageRun: 'messageDelete' },
		{ name: 'list', messageRun: 'messageList' },
		{ name: 'config', messageRun: 'messageConfig', default: true }
	]
})
export class StarboardCommand extends Subcommand {
	public async messageSetChannel(message: Message, args: Args) {
		if (!message.guild) {
			return message.reply('This command can only be used in a server.');
		}

		try {
			const channel = await args.pick('guildTextChannel');

			if (channel.type !== ChannelType.GuildText) {
				return message.reply('Please specify a text channel.');
			}

			setStarboardChannel(message.guild.id, channel.id);
			return message.reply(`✅ Starboard channel set to <#${channel.id}>`);
		} catch (error) {
			return message.reply('Please specify a valid text channel. Usage: `starboard set-channel #channel`');
		}
	}

	public async messageSetThreshold(message: Message, args: Args) {
		if (!message.guild) {
			return message.reply('This command can only be used in a server.');
		}

		try {
			const threshold = await args.pick('integer');

			if (threshold < 1) {
				return message.reply('The star threshold must be at least 1.');
			}

			if (threshold > 50) {
				return message.reply('The star threshold cannot be more than 50.');
			}

			setStarboardThreshold(message.guild.id, threshold);
			return message.reply(`✅ Starboard threshold set to ${threshold} stars.`);
		} catch (error) {
			return message.reply('Please specify a valid number. Usage: `starboard set-threshold <number>`');
		}
	}

	public async messageDelete(message: Message, args: Args) {
		if (!message.guild) {
			return message.reply('This command can only be used in a server.');
		}

		try {
			const indexCode = await args.pick('string');

			const starboardMessage = getStarboardMessageByIndex(indexCode.toUpperCase());
			if (!starboardMessage) {
				return message.reply(`❌ No starboard entry found with index \`${indexCode.toUpperCase()}\``);
			}

			if (starboardMessage.guild_id !== message.guild.id) {
				return message.reply('❌ That starboard entry is not from this server.');
			}

			const deleted = deleteStarboardMessage(indexCode.toUpperCase());
			if (deleted) {
				// Try to delete the starboard message from the channel
				try {
					const config = getStarboardConfig(message.guild.id);
					if (config?.channel_id) {
						const starboardChannel = message.guild.channels.cache.get(config.channel_id);
						if (starboardChannel?.isTextBased()) {
							const starboardMsg = await starboardChannel.messages.fetch(starboardMessage.starboard_message_id).catch(() => null);
							await starboardMsg?.delete().catch(() => {});
						}
					}
				} catch (error) {
					// Ignore errors when trying to delete the message
				}

				return message.reply(`✅ Deleted starboard entry \`${indexCode.toUpperCase()}\``);
			} else {
				return message.reply(`❌ Failed to delete starboard entry \`${indexCode.toUpperCase()}\``);
			}
		} catch (error) {
			return message.reply('Please specify a valid index code. Usage: `starboard delete <index>`');
		}
	}

	public async messageList(message: Message) {
		if (!message.guild) {
			return message.reply('This command can only be used in a server.');
		}

		const starboardMessages = getStarboardMessages(message.guild.id);

		if (starboardMessages.length === 0) {
			return message.reply('📋 No starboard entries found for this server.');
		}

		const paginatedMessage = new PaginatedMessage({
			template: new EmbedBuilder()
				.setColor('#FFD700')
				.setTitle('📋 Starboard Entries')
				.setFooter({ text: `${starboardMessages.length} total entries` })
		});

		// Group entries into pages of 10
		const entriesPerPage = 10;
		for (let i = 0; i < starboardMessages.length; i += entriesPerPage) {
			const page = starboardMessages.slice(i, i + entriesPerPage);
			paginatedMessage.addPageEmbed((embed) =>
				embed.setDescription(
					page.map((entry) => `**${entry.index_code}** - ⭐ ${entry.star_count} - <#${entry.original_channel_id}>`).join('\n')
				)
			);
		}

		const response = await message.reply({ content: 'Loading starboard entries...' });
		await paginatedMessage.run(response, message.author);
		return response;
	}

	public async messageConfig(message: Message) {
		if (!message.guild) {
			return message.reply('This command can only be used in a server.');
		}

		const config = getStarboardConfig(message.guild.id);

		const embed = new EmbedBuilder()
			.setColor('#FFD700')
			.setTitle('⭐ Starboard Configuration')
			.addFields([
				{
					name: 'Channel',
					value: config?.channel_id ? `<#${config.channel_id}>` : 'Not set',
					inline: true
				},
				{
					name: 'Threshold',
					value: config?.threshold?.toString() || '3',
					inline: true
				},
				{
					name: 'Status',
					value: config?.channel_id ? '✅ Active' : '❌ Inactive (no channel set)',
					inline: true
				}
			])
			.setFooter({ text: 'Use starboard set-channel and set-threshold to configure' });

		return message.reply({ embeds: [embed] });
	}
}
