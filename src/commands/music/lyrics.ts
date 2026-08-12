import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, Message } from 'discord.js';
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', flags: MessageFlags.Ephemeral });
		await interaction.deferReply();

		const provided = interaction.options.getString('query', false);
		const query = this.getLyricsQuery(interaction.guildId, provided);
		if (!query) return interaction.followUp('Nothing is playing. Please specify a song name.');

		const lyrics = await fetchLyrics(query);
		if (!lyrics) return interaction.followUp(`No lyrics found for **${query}**.`);

		const embeds = buildLyricsEmbeds(query, lyrics);
		await interaction.followUp({ embeds: [embeds[0]] });
		for (const embed of embeds.slice(1)) {
			await interaction.followUp({ embeds: [embed] });
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');

		const provided = await args.rest('string').catch(() => null);
		const query = this.getLyricsQuery(message.guildId, provided);
		if (!query) return message.reply('Nothing is playing. Please specify a song name.');

		const statusMsg = await message.reply(`🔍 Searching lyrics for **${query}**...`);
		const lyrics = await fetchLyrics(query);
		if (!lyrics) return statusMsg.edit(`No lyrics found for **${query}**.`);

		const embeds = buildLyricsEmbeds(query, lyrics);
		await statusMsg.edit({ content: '', embeds: [embeds[0]] });
		for (const embed of embeds.slice(1)) {
			await message.channel.send({ embeds: [embed] });
		}
	}
}
