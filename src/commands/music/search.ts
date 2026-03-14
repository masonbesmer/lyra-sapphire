import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { ActionRowBuilder, GuildMember, Message, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { PLAYER_META_KEY, type PlayerMeta } from '../../lib/queueMetadata';
import { getMusicConfig } from '../../lib/config';
import { getActiveFilters } from '../../lib/lavalinkFilters';
import { formatDuration } from '../../lib/music';

@ApplyOptions<Command.Options>({
	name: 'search',
	description: 'Search for a track and pick one to play',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((o) => o.setName('query').setDescription('Search query').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const query = interaction.options.getString('query', true);
		const kazagumo = this.container.client.kazagumo;

		await interaction.deferReply({ ephemeral: true });

		const result = await kazagumo.search(query, { requester: interaction.user });
		if (!result.tracks.length) return interaction.followUp({ content: 'No results found.', ephemeral: true });

		const tracks = result.tracks.slice(0, 5);
		const select = new StringSelectMenuBuilder()
			.setCustomId('search_pick')
			.setPlaceholder('Select a track to play')
			.addOptions(
				tracks.map((t, i) =>
					new StringSelectMenuOptionBuilder()
						.setLabel(`${i + 1}. ${t.title}`.slice(0, 100))
						.setDescription(`${t.author ?? ''} — ${formatDuration(t.length ?? 0)}`.slice(0, 100))
						.setValue(t.uri ?? t.title)
				)
			);

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
		await interaction.followUp({ content: '**Search results** — pick one to play:', components: [row], ephemeral: true });

		const collector = interaction.channel!.createMessageComponentCollector({
			filter: (i) => i.customId === 'search_pick' && i.user.id === interaction.user.id,
			time: 30_000,
			max: 1
		});

		collector.on('collect', async (i) => {
			if (!i.isStringSelectMenu()) return;
			const url = i.values[0];
			const member = interaction.member as GuildMember;
			const voiceChannel = member?.voice.channel;
			if (!voiceChannel) return i.update({ content: 'You are no longer in a voice channel.', components: [] });

			try {
				const cfg = getMusicConfig(interaction.guildId);
				const searchResult = await kazagumo.search(url, { requester: interaction.user });
				if (!searchResult.tracks.length) return i.update({ content: 'No results found.', components: [] });

				let player = kazagumo.getPlayer(interaction.guildId);
				if (!player) {
					player = await kazagumo.createPlayer({
						guildId: interaction.guildId,
						voiceId: voiceChannel.id,
						textId: interaction.channelId,
						deaf: true,
						volume: cfg.default_volume
					});
				}

				const meta: PlayerMeta = { interaction, channelId: interaction.channelId, requestedBy: interaction.user };
				player.data.set(PLAYER_META_KEY, meta);
				if (!player.data.has('activeFilters')) player.data.set('activeFilters', getActiveFilters(player));

				player.queue.add(searchResult.tracks[0]);
				if (!player.playing && !player.paused) await player.play();

				return i.update({ content: `queued **${searchResult.tracks[0].title}** ✅`, components: [] });
			} catch (e) {
				this.container.logger.error(`[search] ${String(e)}`);
				return i.update({ content: 'Something went wrong.', components: [] });
			}
		});

		collector.on('end', (collected) => {
			if (collected.size === 0) interaction.editReply({ content: 'Selection timed out.', components: [] }).catch(() => {});
		});
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId || !message.member) return message.reply('This command can only be used in a server!');
		const query = await args.rest('string').catch(() => null);
		if (!query) return message.reply('Please provide a search query. Example: `%search never gonna give you up`');

		const kazagumo = this.container.client.kazagumo;
		const result = await kazagumo.search(query, { requester: message.author });
		if (!result.tracks.length) return message.reply('No results found.');

		const tracks = result.tracks.slice(0, 5);
		const lines = tracks.map((t, i) => `**${i + 1}.** ${t.title} — ${t.author ?? ''} (${formatDuration(t.length ?? 0)})`);
		const reply = await message.reply(`**Search results:**\n${lines.join('\n')}\n\nReply with a number 1-${tracks.length} to pick a track.`);

		const collector = message.channel.createMessageCollector({
			filter: (m) => m.author.id === message.author.id && /^[1-5]$/.test(m.content.trim()),
			time: 30_000,
			max: 1
		});

		collector.on('collect', async (m) => {
			const idx = parseInt(m.content.trim()) - 1;
			const track = tracks[idx];
			if (!track) return;
			const member = message.member as GuildMember;
			const voiceChannel = member?.voice.channel;
			if (!voiceChannel) return m.reply('You are no longer in a voice channel.');

			try {
				const cfg = getMusicConfig(message.guildId!);
				let player = kazagumo.getPlayer(message.guildId!);
				if (!player) {
					player = await kazagumo.createPlayer({
						guildId: message.guildId!,
						voiceId: voiceChannel.id,
						textId: message.channelId,
						deaf: true,
						volume: cfg.default_volume
					});
				}

				const meta: PlayerMeta = { interaction: message, channelId: message.channelId, requestedBy: message.author };
				player.data.set(PLAYER_META_KEY, meta);
				if (!player.data.has('activeFilters')) player.data.set('activeFilters', getActiveFilters(player));

				player.queue.add(track);
				if (!player.playing && !player.paused) await player.play();

				await reply.edit(`queued **${track.title}** ✅`);
			} catch (e) {
				this.container.logger.error(`[search] ${String(e)}`);
				await reply.edit('Something went wrong.');
			}
		});

		collector.on('end', (collected) => {
			if (collected.size === 0) reply.edit('Selection timed out.').catch(() => {});
		});
	}
}
