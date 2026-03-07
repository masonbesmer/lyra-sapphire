import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember, Message } from 'discord.js';
import type { QueueMetadata } from '../../lib/queueMetadata';
import { getMusicConfig } from '../../lib/config';

@ApplyOptions<Command.Options>({
	name: 'play',
	description: 'play music!',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) =>
					option.setName('query').setDescription('The song to play').setRequired(true).setAutocomplete(true)
				)
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		const query = interaction.options.getString('query', true);
		if (!query.trim()) return interaction.respond([]);
		try {
			const player = useMainPlayer();
			const result = await player.search(query, { requestedBy: interaction.user });
			const choices = result.tracks.slice(0, 5).map((t) => ({
				name: `${t.title} — ${t.duration}`.slice(0, 100),
				value: t.url
			}));
			return interaction.respond(choices);
		} catch {
			return interaction.respond([]);
		}
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel!;
		const query = interaction.options.getString('query', true);
		const cfg = getMusicConfig(interaction.guildId);

		await interaction.deferReply();

		try {
			const meta: QueueMetadata = {
				interaction,
				channelId: interaction.channelId,
				requestedBy: interaction.user
			};
			const { track } = await player.play(channel, query, {
				requestedBy: interaction.user,
				nodeOptions: {
					metadata: meta,
					volume: cfg.default_volume
				}
			});

			return interaction.followUp(`queued **${track.title}** ✅`);
		} catch (e) {
			this.container.logger.error(`[play] ${String(e)}`);
			return interaction.followUp('something went wrong, check the logs');
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply('This command can only be used in a server!');
		}
		const channel = message.member.voice.channel;
		if (!channel) return message.reply("you aren't in a voice channel.");

		const query = await args.rest('string').catch(() => null);
		if (!query) return message.reply('Please provide a song name or URL. Example: `%play never gonna give you up`');

		const player = useMainPlayer();
		const cfg = getMusicConfig(message.guildId);

		const statusMsg = await message.reply('🔍 Searching...');
		try {
			const meta: QueueMetadata = {
				interaction: message,
				channelId: message.channelId,
				requestedBy: message.author
			};
			const { track } = await player.play(channel, query, {
				requestedBy: message.author,
				nodeOptions: {
					metadata: meta,
					volume: cfg.default_volume
				}
			});
			return statusMsg.edit(`queued **${track.title}** ✅`);
		} catch (e) {
			this.container.logger.error(`[play] ${String(e)}`);
			return statusMsg.edit('something went wrong, check the logs');
		}
	}
}
