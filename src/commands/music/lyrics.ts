import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { cleanTrackTitle } from '../../lib/music';
import { fetchLyrics, buildLyricsEmbeds } from '../../lib/lyrics';

@ApplyOptions<Command.Options>({
	name: 'lyrics',
	description: 'Fetch lyrics for the current or a specified track',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((o) => o.setName('query').setDescription('Song name (defaults to current track)').setRequired(false))
		);
	}

	private getLyricsQuery(guildId: string | null, provided: string | null): string | null {
		if (provided) return provided;
		if (!guildId) return null;
		const player = this.container.client.kazagumo.getPlayer(guildId);
		if (!player?.queue.current) return null;
		return cleanTrackTitle(player.queue.current.title);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		await interaction.deferReply();

		const provided = interaction.options.getString('query', false);
		const query = this.getLyricsQuery(interaction.guildId, provided);
		if (!query) return interaction.editReply("nothing's playing. give me a song name.");

		const lyrics = await fetchLyrics(query);
		if (!lyrics) return interaction.editReply(`couldn't find lyrics for **${query}**.`);

		const paginatedMessage = new PaginatedMessage();
		for (const embed of buildLyricsEmbeds(query, lyrics)) {
			paginatedMessage.addPageEmbed(embed);
		}
		await paginatedMessage.run(interaction, interaction.user);
		return;
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");

		const provided = await args.rest('string').catch(() => null);
		const query = this.getLyricsQuery(message.guildId, provided);
		if (!query) return message.reply("nothing's playing. give me a song name.");

		const statusMsg = await message.reply(`🔍 searching lyrics for **${query}**...`);
		const lyrics = await fetchLyrics(query);
		if (!lyrics) return statusMsg.edit(`couldn't find lyrics for **${query}**.`);

		const paginatedMessage = new PaginatedMessage();
		for (const embed of buildLyricsEmbeds(query, lyrics)) {
			paginatedMessage.addPageEmbed(embed);
		}
		await paginatedMessage.run(statusMsg, message.author);
		return;
	}
}
