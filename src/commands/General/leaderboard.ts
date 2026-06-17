import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';
import { getMessageLeaderboard, getVoiceLeaderboard } from '../../lib/leaderboard';

function formatVoice(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

@ApplyOptions<Command.Options>({
	description: 'View the server leaderboard'
})
export class LeaderboardCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((opt) =>
					opt
						.setName('stat')
						.setDescription('Which stat to rank by')
						.setRequired(true)
						.addChoices({ name: 'Messages', value: 'messages' }, { name: 'Voice Time', value: 'voice' })
				)
				.addStringOption((opt) =>
					opt
						.setName('period')
						.setDescription('Time window (default: all-time)')
						.setRequired(false)
						.addChoices({ name: 'All Time', value: 'all' }, { name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' })
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guild) {
			return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
		}

		const stat = interaction.options.getString('stat', true) as 'messages' | 'voice';
		const period = (interaction.options.getString('period') ?? 'all') as 'all' | 'weekly' | 'monthly';

		const entries = stat === 'messages' ? getMessageLeaderboard(interaction.guild.id, period) : getVoiceLeaderboard(interaction.guild.id, period);

		const periodLabel = period === 'all' ? 'All Time' : period === 'weekly' ? 'This Week' : 'This Month';
		const statLabel = stat === 'messages' ? 'Messages' : 'Voice Time';

		if (entries.length === 0) {
			return interaction.reply({ content: `No ${statLabel.toLowerCase()} data yet for this server.`, ephemeral: true });
		}

		const lines = await Promise.all(
			entries.map(async (entry, i) => {
				let name: string;
				try {
					const member = await interaction.guild!.members.fetch(entry.userId);
					name = member.displayName;
				} catch {
					name = `<@${entry.userId}>`;
				}
				const valueStr = stat === 'voice' ? formatVoice(entry.value) : entry.value.toLocaleString() + ' messages';
				return `**#${i + 1}** ${name} — ${valueStr}`;
			})
		);

		const embed = new EmbedBuilder()
			.setTitle(`🏆 ${statLabel} Leaderboard — ${periodLabel}`)
			.setDescription(lines.join('\n'))
			.setColor(stat === 'voice' ? '#5865F2' : '#57F287')
			.setFooter({ text: interaction.guild.name })
			.setTimestamp();

		return interaction.reply({ embeds: [embed] });
	}
}
