import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { MessageFlags, GuildMember, Message, type User } from 'discord.js';
import type { KazagumoPlayer } from 'kazagumo';
import { getMusicConfig } from '../../lib/config';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel, searchTracks } from '../../lib/musicCommandHelpers';
import { formatDuration } from '../../lib/music';
import {
	fetchSpotifyTracks,
	parseSpotifyLink,
	resolveInBatches,
	SPOTIFY_TRACK_LIMIT,
	SpotifyError,
	spotifySearchQuery,
	type SpotifyLink
} from '../../lib/spotify';

interface PlayContext {
	guildId: string;
	voiceId: string;
	textId: string;
	requester: User;
	origin: Command.ChatInputCommandInteraction | Message;
	respond: (content: string) => Promise<unknown>;
}

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
			const result = await searchTracks(this.container.client.kazagumo, query, { requester: interaction.user, engine: source });
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel!;
		const query = interaction.options.getString('query', true);
		const source = interaction.options.getString('source', false) ?? 'youtube';

		await interaction.deferReply();

		return this.play(query, source, {
			guildId: interaction.guildId,
			voiceId: channel.id,
			textId: interaction.channelId,
			requester: interaction.user,
			origin: interaction,
			respond: (content) => interaction.editReply(content)
		});
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply("can't do that outside a server.");
		}
		const channel = message.member.voice.channel;
		if (!channel) return message.reply("hey dumbass, you aren't in a voice channel.");

		const query = await args.rest('string').catch(() => null);
		if (!query) return message.reply('give me a song name or a URL. example: `%play never gonna give you up`');

		const statusMsg = await message.reply('🔍 searching...');

		return this.play(query, 'youtube', {
			guildId: message.guildId,
			voiceId: channel.id,
			textId: message.channelId,
			requester: message.author,
			origin: message,
			respond: (content) => statusMsg.edit(content)
		});
	}

	private async play(query: string, source: string, ctx: PlayContext) {
		try {
			const spotify = parseSpotifyLink(query);
			if (spotify) return await this.playSpotify(spotify, ctx);

			const result = await searchTracks(this.container.client.kazagumo, query, { requester: ctx.requester, engine: source });
			if (!result.tracks.length) {
				await this.logEmptySearchDiagnostics(source, query);
				return ctx.respond("❌ couldn't find anything for that.");
			}

			const player = await this.joinPlayer(ctx);
			return ctx.respond(await queueAndLabel(player, result));
		} catch (e) {
			if (e instanceof SpotifyError) return ctx.respond(e.message);
			this.container.logger.error(`[play] ${String(e)}`);
			return ctx.respond('something went wrong on my end, check the logs.');
		}
	}

	private async joinPlayer(ctx: PlayContext): Promise<KazagumoPlayer> {
		const player = await getOrCreatePlayer(this.container.client.kazagumo, {
			guildId: ctx.guildId,
			voiceId: ctx.voiceId,
			textId: ctx.textId,
			volume: getMusicConfig(ctx.guildId).default_volume
		});
		initPlayerMeta(player, { interaction: ctx.origin, channelId: ctx.textId, requestedBy: ctx.requester });
		return player;
	}

	/**
	 * Albums and playlists cost one YouTube search per track, so playback starts with the first
	 * batch that resolves and the rest are queued behind it.
	 */
	private async playSpotify(link: SpotifyLink, ctx: PlayContext) {
		if (link.kind === 'unsupported') return ctx.respond('❌ only Spotify track, album and playlist links work here.');

		const { kazagumo } = this.container.client;
		const { logger } = this.container;
		const collection = await fetchSpotifyTracks(link);
		const search = (q: string) => searchTracks(kazagumo, q, { requester: ctx.requester }).then((r) => r.tracks[0]);

		if (link.kind === 'track') {
			const track = collection.tracks[0] ? await search(spotifySearchQuery(collection.tracks[0])) : undefined;
			if (!track) return ctx.respond("❌ couldn't find that song on YouTube.");
			const player = await this.joinPlayer(ctx);
			return ctx.respond(await queueAndLabel(player, { type: 'TRACK', tracks: [track] }));
		}

		const label = `${link.kind} **${collection.name ?? 'Unknown'}**`;
		const capNote = collection.total > SPOTIFY_TRACK_LIMIT ? `first ${SPOTIFY_TRACK_LIMIT} of ${collection.total}` : null;
		let player: KazagumoPlayer | undefined;
		let queued = 0;

		let outcome: Awaited<ReturnType<typeof resolveInBatches>>;
		try {
			const searchLoggingFailures = (q: string) =>
				search(q).catch((e: unknown) => {
					logger.warn(`[play] YouTube search for Spotify track "${q}" failed: ${String(e)}`);
					throw e;
				});
			outcome = await resolveInBatches(collection.tracks, searchLoggingFailures, async (found) => {
				const first = !player;
				if (!player) player = await this.joinPlayer(ctx);
				else if (kazagumo.getPlayer(ctx.guildId) !== player) return false;

				// KazagumoQueue#add shifts the array it is handed when nothing is current.
				const count = found.length;
				player.queue.add(found);
				queued += count;
				if (!player.playing && !player.paused) await player.play();
				if (first) await ctx.respond(`⏳ started ${label}${capNote ? ` (${capNote})` : ''}, finding the rest...`);
				return true;
			});
		} catch (e) {
			if (!queued) throw e;
			logger.error(`[play] queueing ${link.kind} ${link.id} failed after ${queued} tracks: ${String(e)}`);
			return ctx.respond(`⚠️ queued ${queued} tracks of ${label}, then something went wrong on my end, check the logs.`);
		}

		const failedNote = outcome.failed ? `, ${outcome.failed} searches failed` : '';
		if (outcome.stopped) return ctx.respond(`⏹️ stopped queueing ${label} after ${queued} tracks, the player went away.`);
		if (!queued) {
			return ctx.respond(
				outcome.failed ? `❌ YouTube search failed for ${label}, check the logs.` : `❌ couldn't find any of ${label} on YouTube.`
			);
		}
		return ctx.respond(`✅ queued ${label} (${queued} tracks${capNote ? `, ${capNote}` : ''}${failedNote})`);
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
