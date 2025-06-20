import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { Command, Args } from '@sapphire/framework';
import { db } from '../../lib/database';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { EmbedBuilder, type Message } from 'discord.js';
import { sendLoadingMessage } from '../../lib/utils';

@ApplyOptions<Subcommand.Options>({
	name: 'keyword',
	description: 'Manage word trigger keywords',
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

	// Slash command handlers
	public async chatInputAdd(interaction: Command.ChatInputCommandInteraction) {
		const keyword = interaction.options.getString('keyword', true).toLowerCase();
		const response = interaction.options.getString('response', true);
		try {
			db.prepare('INSERT INTO word_triggers (keyword, response) VALUES (?, ?)').run(keyword, response);
			return interaction.reply({ content: `Added trigger for \`${keyword}\``, ephemeral: true });
		} catch (error) {
			return interaction.reply({ content: `Failed to add trigger: ${String(error)}`, ephemeral: true });
		}
	}

	public async chatInputDelete(interaction: Command.ChatInputCommandInteraction) {
		const keyword = interaction.options.getString('keyword', true).toLowerCase();
		const stmt = db.prepare('DELETE FROM word_triggers WHERE keyword = ?');
		const info = stmt.run(keyword);
		if (info.changes === 0) {
			return interaction.reply({ content: `No trigger found for \`${keyword}\``, ephemeral: true });
		}
		return interaction.reply({ content: `Deleted trigger for \`${keyword}\``, ephemeral: true });
	}

	public async chatInputEdit(interaction: Command.ChatInputCommandInteraction) {
		const keyword = interaction.options.getString('keyword', true).toLowerCase();
		const response = interaction.options.getString('response', true);
		const stmt = db.prepare('UPDATE word_triggers SET response = ? WHERE keyword = ?');
		const info = stmt.run(response, keyword);
		if (info.changes === 0) {
			return interaction.reply({ content: `No trigger found for \`${keyword}\``, ephemeral: true });
		}
		return interaction.reply({ content: `Updated trigger for \`${keyword}\``, ephemeral: true });
	}

	public async chatInputList(interaction: Command.ChatInputCommandInteraction) {
		const rows = db.prepare('SELECT keyword, response FROM word_triggers ORDER BY keyword').all() as {
			keyword: string;
			response: string;
		}[];

		if (rows.length === 0) {
			return interaction.reply({ content: 'No keyword triggers found.', ephemeral: true });
		}

		const paginatedMessage = new PaginatedMessage({
			template: new EmbedBuilder().setColor('#FF0000').setTitle('Keyword Triggers')
		});

		const perPage = 10;
		for (let i = 0; i < rows.length; i += perPage) {
			const page = rows.slice(i, i + perPage);
			paginatedMessage.addPageEmbed((embed) => embed.setDescription(page.map((r) => `**${r.keyword}** → ${r.response}`).join('\n')));
		}

		await interaction.deferReply({ ephemeral: true });
		await paginatedMessage.run(interaction, interaction.user);
	}

	// Message command handlers
	public async messageAdd(message: Message, args: Args) {
		const keyword = (await args.pick('string')).toLowerCase();
		const response = await args.rest('string');
		try {
			db.prepare('INSERT INTO word_triggers (keyword, response) VALUES (?, ?)').run(keyword, response);
			return message.reply(`Added trigger for \`${keyword}\``);
		} catch (error) {
			return message.reply(`Failed to add trigger: ${String(error)}`);
		}
	}

	public async messageDelete(message: Message, args: Args) {
		const keyword = (await args.pick('string')).toLowerCase();
		const info = db.prepare('DELETE FROM word_triggers WHERE keyword = ?').run(keyword);
		if (info.changes === 0) {
			return message.reply(`No trigger found for \`${keyword}\``);
		}
		return message.reply(`Deleted trigger for \`${keyword}\``);
	}

	public async messageEdit(message: Message, args: Args) {
		const keyword = (await args.pick('string')).toLowerCase();
		const response = await args.rest('string');
		const info = db.prepare('UPDATE word_triggers SET response = ? WHERE keyword = ?').run(response, keyword);
		if (info.changes === 0) {
			return message.reply(`No trigger found for \`${keyword}\``);
		}
		return message.reply(`Updated trigger for \`${keyword}\``);
	}

	public async messageList(message: Message) {
		const rows = db.prepare('SELECT keyword, response FROM word_triggers ORDER BY keyword').all() as {
			keyword: string;
			response: string;
		}[];

		if (rows.length === 0) {
			return message.reply('No keyword triggers found.');
		}

		const response = await sendLoadingMessage(message);

		const paginatedMessage = new PaginatedMessage({
			template: new EmbedBuilder().setColor('#FF0000').setTitle('Keyword Triggers')
		});

		const perPage = 10;
		for (let i = 0; i < rows.length; i += perPage) {
			const page = rows.slice(i, i + perPage);
			paginatedMessage.addPageEmbed((embed) => embed.setDescription(page.map((r) => `**${r.keyword}** → ${r.response}`).join('\n')));
		}

		await paginatedMessage.run(response, message.author);
		return response;
	}
}
