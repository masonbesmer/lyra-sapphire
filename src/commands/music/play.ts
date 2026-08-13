import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, GuildMember, Message } from 'discord.js';
import { getMusicConfig } from '../../lib/config';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel } from '../../lib/musicCommandHelpers';
import { formatDuration } from '../../lib/music';

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
				.addStringOption((option) => option.setName('query').setDescription('The song to play').setRequired(true).setAutocomplete(true))
				.addStringOption((o) =>
					o
						.setName('source')
						.setDescription('Search source (defaults to YouTube)')
						.setRequired(false)
						.addChoices({ name: 'YouTube', value: 'youtube' })
				)
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		const query = interaction.options.getString('query', true);
		const source = interaction.options.getString('source', false) ?? 'youtube';
		if (!query.trim()) return interaction.respond([]);
		try {
			const result = await this.container.client.kazagumo.search(query, { requester: interaction.user, engine: source });
			const choices = result.tracks.slice(0, 5).map((t) => ({
				name: `${t.title} — ${formatDuration(t.length ?? 0)}`.slice(0, 100),
				value: t.uri ?? t.title
			}));
			return interaction.respond(choices);
		} catch {
			return interaction.respond([]);
		}
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', flags: MessageFlags.Ephemeral });
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel!;
		const query = interaction.options.getString('query', true);
		const source = interaction.options.getString('source', false) ?? 'youtube';
		const cfg = getMusicConfig(interaction.guildId);

		await interaction.deferReply();

		try {
			const kazagumo = this.container.client.kazagumo;
			const result = await kazagumo.search(query, { requester: interaction.user, engine: source });
			if (!result.tracks.length) {
				await this.logEmptySearchDiagnostics(source, query);
				return interaction.editReply('❌ No results found.');
			}

			const player = await getOrCreatePlayer(kazagumo, {
				guildId: interaction.guildId,
				voiceId: channel.id,
				textId: interaction.channelId,
				volume: cfg.default_volume
			});
			initPlayerMeta(player, { interaction, channelId: interaction.channelId, requestedBy: interaction.user });
			return interaction.editReply(await queueAndLabel(player, result));
		} catch (e) {
			this.container.logger.error(`[play] ${String(e)}`);
			return interaction.editReply('something went wrong, check the logs');
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

		const cfg = getMusicConfig(message.guildId);
		const statusMsg = await message.reply('🔍 Searching...');

		try {
			const kazagumo = this.container.client.kazagumo;
			const result = await kazagumo.search(query, { requester: message.author });
			if (!result.tracks.length) {
				await this.logEmptySearchDiagnostics('youtube', query);
				return statusMsg.edit('❌ No results found.');
			}

			const player = await getOrCreatePlayer(kazagumo, {
				guildId: message.guildId,
				voiceId: channel.id,
				textId: message.channelId,
				volume: cfg.default_volume
			});
			initPlayerMeta(player, { interaction: message, channelId: message.channelId, requestedBy: message.author });
			return statusMsg.edit(await queueAndLabel(player, result));
		} catch (e) {
			this.container.logger.error(`[play] ${String(e)}`);
			return statusMsg.edit('something went wrong, check the logs');
		}
	}

	// TEMP diagnostic: Lavalink returns an empty track list for both genuine no-matches and a
	// swallowed loadType:"error" (Kazagumo discards the exception detail either way — see
	// kazagumo/dist/Kazagumo.js search()'s default switch case). This re-issues the same
	// /v4/loadtracks lookup directly against the node to surface the real loadType/exception.
	// Remove once the YouTube empty-search root cause is confirmed.
	private async logEmptySearchDiagnostics(engine: string, query: string): Promise<void> {
		try {
			const node = [...this.container.client.kazagumo.shoukaku.nodes.values()][0];
			if (!node) return;
			const isUrl = /^https?:\/\//.test(query);
			const prefix = engine === 'soundcloud' ? 'scsearch:' : 'ytsearch:';
			const raw = await node.rest.resolve(isUrl ? query : `${prefix}${query}`);
			const detail = raw?.loadType === 'error' ? ` exception=${JSON.stringify(raw.data)}` : '';
			this.container.logger.warn(
				`[play] empty search diagnostics: engine=${engine} query="${query}" loadType=${raw?.loadType ?? 'none'}${detail}`
			);
		} catch (e) {
			this.container.logger.warn(`[play] empty search diagnostics failed: ${String(e)}`);
		}
	}
}
