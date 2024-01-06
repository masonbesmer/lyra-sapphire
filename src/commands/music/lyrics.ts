import { lyricsExtractor } from '@discord-player/extractor';
import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { useQueue } from 'discord-player';
import { EmbedBuilder } from 'discord.js';

const genius = lyricsExtractor();

@ApplyOptions<Command.Options>({
	description: 'Get lyrics for the current song, or a different one, if specified.'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) => {
					return option.setName('query').setDescription('The song to get lyrics for').setRequired(false).setAutocomplete(true);
				})
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();
		const queue = useQueue(interaction.guildId!);
		const track = interaction.options.getString('query') ?? queue?.currentTrack?.title;
		if (!track) return interaction.followUp({ content: 'no track specified', ephemeral: true });
		const lyrics = await genius.search(track).catch(() => null);

		if (!lyrics) return interaction.followUp({ content: 'no lyrics found', ephemeral: true });

		const trimmedLyrics = lyrics.lyrics.substring(0, 1997);

		const embed = new EmbedBuilder()
			.setTitle(`Lyrics for ${lyrics.fullTitle}`)
			.setURL(lyrics.url)
			.setThumbnail(lyrics.thumbnail)
			.setAuthor({
				name: lyrics.artist.name,
				iconURL: lyrics.artist.image,
				url: lyrics.artist.url
			})
			.setDescription(trimmedLyrics.length === 1997 ? `${trimmedLyrics}...` : trimmedLyrics)
			.setColor('#00FF00');

		return interaction.followUp({ embeds: [embed] });
	}
}
