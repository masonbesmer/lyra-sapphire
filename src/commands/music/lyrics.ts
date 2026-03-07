import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { EmbedBuilder, Message } from 'discord.js';
import { cleanTrackTitle } from '../../lib/music';

async function fetchLyrics(query: string): Promise<string | null> {
	try {
		const { Client } = await import('genius-lyrics');
		const client = new Client();
		const searches = await client.songs.search(query);
		if (!searches.length) return null;
		const lyrics = await searches[0].lyrics();
		return lyrics || null;
	} catch {
		return null;
	}
}

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

	private async getLyricsQuery(guildId: string | null, provided: string | null): Promise<string | null> {
		if (provided) return provided;
		if (!guildId) return null;
		const player = useMainPlayer();
		const queue = player.nodes.get(guildId);
		if (!queue?.currentTrack) return null;
		return cleanTrackTitle(queue.currentTrack.title);
	}

	private buildLyricsEmbed(title: string, lyrics: string): EmbedBuilder[] {
		// Discord embed description limit is 4096 characters, total embed limit is 6000
		const maxLen = 4096;
		const chunks: string[] = [];
		let remaining = lyrics;
		while (remaining.length > 0) {
			chunks.push(remaining.slice(0, maxLen));
			remaining = remaining.slice(maxLen);
		}
		return chunks.slice(0, 5).map((chunk, i) =>
			new EmbedBuilder()
				.setTitle(i === 0 ? `📜 ${title}`.slice(0, 256) : `📜 ${title} (cont.)`.slice(0, 256))
				.setDescription(chunk)
				.setColor(0xffdd57)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		await interaction.deferReply();

		const provided = interaction.options.getString('query', false);
		const query = await this.getLyricsQuery(interaction.guildId, provided);
		if (!query) return interaction.followUp('Nothing is playing. Please specify a song name.');

		const lyrics = await fetchLyrics(query);
		if (!lyrics) return interaction.followUp(`No lyrics found for **${query}**.`);

		const embeds = this.buildLyricsEmbed(query, lyrics);
		await interaction.followUp({ embeds: [embeds[0]] });
		for (const embed of embeds.slice(1)) {
			await interaction.followUp({ embeds: [embed] });
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');

		const provided = await args.rest('string').catch(() => null);
		const query = await this.getLyricsQuery(message.guildId, provided);
		if (!query) return message.reply('Nothing is playing. Please specify a song name.');

		const statusMsg = await message.reply(`🔍 Searching lyrics for **${query}**...`);
		const lyrics = await fetchLyrics(query);
		if (!lyrics) return statusMsg.edit(`No lyrics found for **${query}**.`);

		const embeds = this.buildLyricsEmbed(query, lyrics);
		await statusMsg.edit({ content: '', embeds: [embeds[0]] });
		for (const embed of embeds.slice(1)) {
			await message.channel.send({ embeds: [embed] });
		}
	}
}
