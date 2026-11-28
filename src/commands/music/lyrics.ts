import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { cleanTrackTitle } from '../../lib/music';
import { fetchLyrics, buildLyricsEmbeds, type LyricsTrack } from '../../lib/lyrics';

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

	/** The user's text, or the playing track (with author and length, which make the match far more reliable). */
	private getLyricsQuery(guildId: string | null, provided: string | null): { input: LyricsTrack | string; label: string } | null {
		if (provided) return { input: provided, label: provided };
		if (!guildId) return null;
		const track = this.container.client.kazagumo.getPlayer(guildId)?.queue.current;
		if (!track) return null;
		return { input: { title: track.title, author: track.author, length: track.length }, label: cleanTrackTitle(track.title) };
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		await interaction.deferReply();

		const provided = interaction.options.getString('query', false);
		const query = this.getLyricsQuery(interaction.guildId, provided);
		if (!query) return interaction.editReply("nothing's playing. give me a song name.");

		const result = await fetchLyrics(query.input);
		if (!result) return interaction.editReply(`couldn't find lyrics for **${query.label}**.`);

		const paginatedMessage = new PaginatedMessage();
		for (const embed of buildLyricsEmbeds(result.title, result.lyrics)) {
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

		const statusMsg = await message.reply(`🔍 searching lyrics for **${query.label}**...`);
		const result = await fetchLyrics(query.input);
		if (!result) return statusMsg.edit(`couldn't find lyrics for **${query.label}**.`);

		const paginatedMessage = new PaginatedMessage();
		for (const embed of buildLyricsEmbeds(result.title, result.lyrics)) {
			paginatedMessage.addPageEmbed(embed);
		}
		await paginatedMessage.run(statusMsg, message.author);
		return;
	}
}
