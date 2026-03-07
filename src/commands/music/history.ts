import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { EmbedBuilder, Message } from 'discord.js';
import { getPlayHistory, getTopTracks, getTopUsers } from '../../lib/musicHistory';
import { formatDuration } from '../../lib/music';

const PAGE_SIZE = 20;

function buildHistoryEmbed(guildId: string, page: number): EmbedBuilder {
	const offset = (page - 1) * PAGE_SIZE;
	const rows = getPlayHistory(guildId, PAGE_SIZE, offset);

	if (rows.length === 0) {
		return new EmbedBuilder().setTitle('📜 Play History').setDescription(page === 1 ? 'No tracks have been played yet.' : 'No more tracks.').setColor(0x5865f2);
	}

	const lines = rows.map((r, i) => {
		const num = offset + i + 1;
		const when = new Date(r.played_at).toLocaleDateString();
		const dur = r.track_duration_ms ? ` (${formatDuration(r.track_duration_ms)})` : '';
		return `**${num}.** [${r.track_title}](${r.track_url})${dur}\n┗ by <@${r.user_id}> on ${when}`;
	});

	return new EmbedBuilder()
		.setTitle(`📜 Play History — Page ${page}`)
		.setDescription(lines.join('\n\n'))
		.setColor(0x5865f2)
		.setFooter({ text: `Page ${page} • ${PAGE_SIZE} tracks per page` });
}

function buildStatsEmbed(guildId: string): EmbedBuilder {
	const topTracks = getTopTracks(guildId, 10);
	const topUsers = getTopUsers(guildId, 5);

	const trackLines = topTracks.length
		? topTracks.map((t, i) => `**${i + 1}.** [${t.track_title}](${t.track_url}) — played **${t.play_count}×**`)
		: ['No data yet.'];

	const userLines = topUsers.length ? topUsers.map((u, i) => `**${i + 1}.** <@${u.user_id}> — **${u.play_count}** tracks queued`) : ['No data yet.'];

	return new EmbedBuilder()
		.setTitle('📊 Play History Stats')
		.addFields(
			{ name: '🔥 Top 10 Tracks', value: trackLines.join('\n'), inline: false },
			{ name: '🎧 Top 5 DJs', value: userLines.join('\n'), inline: false }
		)
		.setColor(0xf4a41b);
}

@ApplyOptions<Subcommand.Options>({
	name: 'history',
	description: 'View play history and stats',
	subcommands: [
		{ name: 'list', chatInputRun: 'chatInputList', messageRun: 'messageList', default: true },
		{ name: 'stats', chatInputRun: 'chatInputStats', messageRun: 'messageStats' }
	]
})
export class HistoryCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('list')
						.setDescription('Show last 20 tracks played in this server')
						.addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false).setMinValue(1))
				)
				.addSubcommand((sub) => sub.setName('stats').setDescription('Top tracks and most active DJs'))
		);
	}

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const page = interaction.options.getInteger('page', false) ?? 1;
		return interaction.reply({ embeds: [buildHistoryEmbed(interaction.guildId, page)] });
	}

	public async messageList(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const page = (await args.pick('integer').catch(() => null)) ?? 1;
		return message.reply({ embeds: [buildHistoryEmbed(message.guildId, page)] });
	}

	public async chatInputStats(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		return interaction.reply({ embeds: [buildStatsEmbed(interaction.guildId)] });
	}

	public async messageStats(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		return message.reply({ embeds: [buildStatsEmbed(message.guildId)] });
	}
}
