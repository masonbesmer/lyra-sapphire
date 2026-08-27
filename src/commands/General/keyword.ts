import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { Command, Args } from '@sapphire/framework';
import { getWordTriggers, setWordTrigger, deleteWordTrigger } from '../../lib/config';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { MessageFlags, EmbedBuilder, PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import { sendLoadingMessage } from '../../lib/utils';

@ApplyOptions<Subcommand.Options>({
	name: 'keyword',
	description: 'Manage word trigger keywords',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	subcommands: [
		{ name: 'add', chatInputRun: 'chatInputAdd', messageRun: 'messageAdd' },
		{ name: 'delete', chatInputRun: 'chatInputDelete', messageRun: 'messageDelete' },
		{ name: 'edit', chatInputRun: 'chatInputEdit', messageRun: 'messageEdit' },
		{ name: 'list', chatInputRun: 'chatInputList', messageRun: 'messageList' }
	]
})
export class KeywordCommand extends Subcommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add a new keyword response')
						.addStringOption((opt) => opt.setName('keyword').setDescription('Keyword').setRequired(true))
						.addStringOption((opt) => opt.setName('response').setDescription('Response').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a keyword response')
						.addStringOption((opt) => opt.setName('keyword').setDescription('Keyword').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('edit')
						.setDescription('Edit a keyword response')
						.addStringOption((opt) => opt.setName('keyword').setDescription('Keyword').setRequired(true))
						.addStringOption((opt) => opt.setName('response').setDescription('New response').setRequired(true))
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List all keyword responses'))
		);
	}

	/** The trigger's response is the audited value, so the log shows what the reply used to say. */
	private auditTrigger(guildId: string, member: GuildMember, keyword: string, next: string | null) {
		const previous = getWordTriggers(guildId).find((trigger) => trigger.keyword === keyword)?.response ?? null;
		return () => recordConfigChange(guildId, auditActor(member, 'discord'), 'triggers', keyword, previous, next);
	}

	// Slash command handlers
	public async chatInputAdd(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });
		const keyword = interaction.options.getString('keyword', true).toLowerCase();
		const response = interaction.options.getString('response', true);
		try {
			const commit = this.auditTrigger(interaction.guildId, interaction.member as GuildMember, keyword, response);
			setWordTrigger(interaction.guildId, keyword, response);
			commit();
			return interaction.reply({ content: `✅ added a trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
		} catch (error) {
			return interaction.reply({ content: `❌ failed to add that trigger: ${String(error)}`, flags: MessageFlags.Ephemeral });
		}
	}

	public async chatInputDelete(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });
		const keyword = interaction.options.getString('keyword', true).toLowerCase();
		const commit = this.auditTrigger(interaction.guildId, interaction.member as GuildMember, keyword, null);
		if (!deleteWordTrigger(interaction.guildId, keyword)) {
			return interaction.reply({ content: `no trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
		}
		commit();
		return interaction.reply({ content: `✅ deleted the trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputEdit(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });
		const keyword = interaction.options.getString('keyword', true).toLowerCase();
		const response = interaction.options.getString('response', true);
		if (!getWordTriggers(interaction.guildId).some((t) => t.keyword === keyword)) {
			return interaction.reply({ content: `no trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
		}
		const commit = this.auditTrigger(interaction.guildId, interaction.member as GuildMember, keyword, response);
		setWordTrigger(interaction.guildId, keyword, response);
		commit();
		return interaction.reply({ content: `✅ updated the trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputList(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });
		const rows = getWordTriggers(interaction.guildId);

		if (rows.length === 0) {
			const embed = new EmbedBuilder()
				.setColor('#6B73FF')
				.setTitle('📝 Keyword Triggers')
				.setDescription('nothing set up yet.\n\nuse `/keyword add` to create your first trigger.')
				.setFooter({ text: 'Tip: Keyword triggers respond automatically when someone mentions a keyword' });
			return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}

		const paginatedMessage = new PaginatedMessage({
			template: new EmbedBuilder()
				.setColor('#6B73FF')
				.setTitle('📝 Keyword Triggers')
				.setFooter({ text: `Total: ${rows.length} keyword${rows.length === 1 ? '' : 's'}` })
		});

		const perPage = 8;
		for (let i = 0; i < rows.length; i += perPage) {
			const page = rows.slice(i, i + perPage);
			const pageNumber = Math.floor(i / perPage) + 1;
			const totalPages = Math.ceil(rows.length / perPage);

			paginatedMessage.addPageEmbed((embed) => {
				const description = page
					.map((r, index) => {
						const globalIndex = i + index + 1;
						// Truncate response if too long for better readability
						const truncatedResponse = r.response.length > 80 ? r.response.substring(0, 77) + '...' : r.response;
						return `\`${globalIndex.toString().padStart(2, '0')}.\` **\`${r.keyword}\`**\n    ↳ ${truncatedResponse}`;
					})
					.join('\n\n');

				return embed.setDescription(description).setFooter({
					text: `Page ${pageNumber} of ${totalPages} • Total: ${rows.length} keyword${rows.length === 1 ? '' : 's'}`
				});
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await paginatedMessage.run(interaction, interaction.user);
		return;
	}

	// Message command handlers
	public async messageAdd(message: Message, args: Args) {
		if (!message.guildId) return message.reply('use this in a server.');
		const keyword = (await args.pick('string')).toLowerCase();
		const response = await args.rest('string');
		try {
			const commit = this.auditTrigger(message.guildId, message.member as GuildMember, keyword, response);
			setWordTrigger(message.guildId, keyword, response);
			commit();
			return message.reply(`✅ added a trigger for \`${keyword}\`.`);
		} catch (error) {
			return message.reply(`❌ failed to add that trigger: ${String(error)}`);
		}
	}

	public async messageDelete(message: Message, args: Args) {
		if (!message.guildId) return message.reply('use this in a server.');
		const keyword = (await args.pick('string')).toLowerCase();
		const commit = this.auditTrigger(message.guildId, message.member as GuildMember, keyword, null);
		if (!deleteWordTrigger(message.guildId, keyword)) {
			return message.reply(`no trigger for \`${keyword}\`.`);
		}
		commit();
		return message.reply(`✅ deleted the trigger for \`${keyword}\`.`);
	}

	public async messageEdit(message: Message, args: Args) {
		if (!message.guildId) return message.reply('use this in a server.');
		const keyword = (await args.pick('string')).toLowerCase();
		const response = await args.rest('string');
		if (!getWordTriggers(message.guildId).some((t) => t.keyword === keyword)) {
			return message.reply(`no trigger for \`${keyword}\`.`);
		}
		const commit = this.auditTrigger(message.guildId, message.member as GuildMember, keyword, response);
		setWordTrigger(message.guildId, keyword, response);
		commit();
		return message.reply(`✅ updated the trigger for \`${keyword}\`.`);
	}

	public async messageList(message: Message) {
		if (!message.guildId) return message.reply('use this in a server.');
		const rows = getWordTriggers(message.guildId);

		if (rows.length === 0) {
			const embed = new EmbedBuilder()
				.setColor('#6B73FF')
				.setTitle('📝 Keyword Triggers')
				.setDescription('nothing set up yet.\n\nuse `keyword add <keyword> <response>` to create your first trigger.')
				.setFooter({ text: 'Tip: Keyword triggers respond automatically when someone mentions a keyword' });
			return message.reply({ embeds: [embed] });
		}

		const response = await sendLoadingMessage(message);

		const paginatedMessage = new PaginatedMessage({
			template: new EmbedBuilder()
				.setColor('#6B73FF')
				.setTitle('📝 Keyword Triggers')
				.setFooter({ text: `Total: ${rows.length} keyword${rows.length === 1 ? '' : 's'}` })
		});

		const perPage = 8;
		for (let i = 0; i < rows.length; i += perPage) {
			const page = rows.slice(i, i + perPage);
			const pageNumber = Math.floor(i / perPage) + 1;
			const totalPages = Math.ceil(rows.length / perPage);

			paginatedMessage.addPageEmbed((embed) => {
				const description = page
					.map((r, index) => {
						const globalIndex = i + index + 1;
						// Truncate response if too long for better readability
						const truncatedResponse = r.response.length > 80 ? r.response.substring(0, 77) + '...' : r.response;
						return `\`${globalIndex.toString().padStart(2, '0')}.\` **\`${r.keyword}\`**\n    ↳ ${truncatedResponse}`;
					})
					.join('\n\n');

				return embed.setDescription(description).setFooter({
					text: `Page ${pageNumber} of ${totalPages} • Total: ${rows.length} keyword${rows.length === 1 ? '' : 's'}`
				});
			});
		}

		await paginatedMessage.run(response, message.author);
		return response;
	}
}
