import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { AttachmentBuilder, EmbedBuilder, MessageFlags, type Guild } from 'discord.js';
import { formatDuration } from '../../lib/music';
import {
	addTracks,
	authorizePlaylist,
	createPlaylist,
	deletePlaylist,
	getCover,
	listTracks,
	listVisiblePlaylists,
	listWritablePlaylists,
	MAX_DESCRIPTION_LENGTH,
	MAX_NAME_LENGTH,
	MAX_PLAYLISTS_PER_OWNER,
	MAX_REPEAT,
	MAX_TRACKS_PER_PLAYLIST,
	moveTrack,
	removeTrack,
	type NewTrack,
	type Playlist,
	type PlaylistRight
} from '../../lib/playlists';
import { currentTrack, playPlaylist, resolveTracksForQuery, toNewTrack } from '../../lib/playlistPlayback';
import { getMusicBotChannelId } from '../../lib/voice/musicClient';

const PAGE_SIZE = 20;
const LIST_LIMIT = 25;

/** The right each subcommand needs, which also decides what its autocomplete offers. */
const NEEDS: Record<string, PlaylistRight> = {
	delete: 'manage',
	add: 'create',
	'add-current': 'create',
	remove: 'delete',
	move: 'update',
	view: 'read',
	play: 'read'
};

const NOT_FOUND = "couldn't find that playlist.";
const FORBIDDEN = "you don't have permission to do that to this playlist.";
const OUTSIDE_GUILD = "can't do that outside a server.";

type GuildInteraction = Subcommand.ChatInputCommandInteraction<'cached'>;

function describe(playlist: Playlist): string {
	const length = playlist.totalLengthMs ? `, ${formatDuration(playlist.totalLengthMs)}` : '';
	return `**${playlist.name}** by <@${playlist.ownerId}> — ${playlist.trackCount} tracks${length}${playlist.isPublic ? ' • public' : ''}`;
}

function section(playlists: Playlist[]): string {
	if (!playlists.length) return 'none';
	const lines = playlists.slice(0, LIST_LIMIT).map(describe);
	const more = playlists.length - lines.length;
	const text = lines.join('\n') + (more > 0 ? `\n…and ${more} more` : '');
	return text.length > 1024 ? `${text.slice(0, 1020)}…` : text;
}

@ApplyOptions<Subcommand.Options>({
	name: 'playlist',
	description: 'Save, share and play your own playlists',
	subcommands: [
		{ name: 'create', chatInputRun: 'chatInputCreate' },
		{ name: 'delete', chatInputRun: 'chatInputDelete' },
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'add-current', chatInputRun: 'chatInputAddCurrent' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'move', chatInputRun: 'chatInputMove' },
		{ name: 'list', chatInputRun: 'chatInputList' },
		{ name: 'view', chatInputRun: 'chatInputView' },
		{ name: 'play', chatInputRun: 'chatInputPlay' }
	]
})
export class PlaylistCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('create')
						.setDescription('Start a new playlist')
						.addStringOption((o) => o.setName('name').setDescription('What to call it').setRequired(true).setMaxLength(MAX_NAME_LENGTH))
						.addStringOption((o) =>
							o.setName('description').setDescription('What it is for').setRequired(false).setMaxLength(MAX_DESCRIPTION_LENGTH)
						)
						.addBooleanOption((o) =>
							o.setName('public').setDescription('Let anyone in a server you share play it (default: private)').setRequired(false)
						)
				)
				.addSubcommand((sub) => sub.setName('delete').setDescription('Delete one of your playlists').addStringOption(playlistOption))
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add a track, or every track of a playlist link')
						.addStringOption(playlistOption)
						.addStringOption((o) => o.setName('query').setDescription('A song name or a URL').setRequired(true))
				)
				.addSubcommand((sub) => sub.setName('add-current').setDescription("Add what's playing right now").addStringOption(playlistOption))
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove a track')
						.addStringOption(playlistOption)
						.addIntegerOption((o) =>
							o.setName('position').setDescription('Its number in /playlist view').setRequired(true).setMinValue(1)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('move')
						.setDescription('Move a track to another position')
						.addStringOption(playlistOption)
						.addIntegerOption((o) => o.setName('from').setDescription('Its current number').setRequired(true).setMinValue(1))
						.addIntegerOption((o) => o.setName('to').setDescription('Its new number').setRequired(true).setMinValue(1))
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('Your playlists, ones shared with you, and public ones here'))
				.addSubcommand((sub) =>
					sub
						.setName('view')
						.setDescription("See a playlist's tracks")
						.addStringOption(playlistOption)
						.addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false).setMinValue(1))
				)
				.addSubcommand((sub) =>
					sub
						.setName('play')
						.setDescription('Queue a playlist')
						.addStringOption(playlistOption)
						.addBooleanOption((o) => o.setName('shuffle').setDescription('Shuffle its tracks').setRequired(false))
						.addBooleanOption((o) => o.setName('loop').setDescription('Loop the whole queue afterwards (DJ only)').setRequired(false))
						.addIntegerOption((o) =>
							o.setName('repeat').setDescription('Queue it this many times').setRequired(false).setMinValue(1).setMaxValue(MAX_REPEAT)
						)
				)
		);
	}

	public override async autocompleteRun(interaction: Subcommand.AutocompleteInteraction) {
		if (!interaction.inCachedGuild()) return interaction.respond([]);
		const need = NEEDS[interaction.options.getSubcommand()] ?? 'read';
		const typed = interaction.options.getFocused().toLowerCase();

		const candidates = await this.candidates(interaction.guild, interaction.user.id, need);
		const choices = candidates
			.filter((playlist) => playlist.name.toLowerCase().includes(typed))
			.slice(0, 25)
			.map((playlist) => ({ name: this.choiceName(playlist, interaction.user.id), value: String(playlist.id) }));
		return interaction.respond(choices);
	}

	public async chatInputCreate(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const result = createPlaylist(interaction.user.id, {
			name: interaction.options.getString('name', true),
			description: interaction.options.getString('description'),
			isPublic: interaction.options.getBoolean('public') ?? false
		});
		if (!result.ok) {
			const reason = {
				invalid_name: `a playlist name needs 1 to ${MAX_NAME_LENGTH} characters on one line.`,
				duplicate: 'you already have a playlist with that name.',
				limit: `you already have ${MAX_PLAYLISTS_PER_OWNER} playlists, delete one first.`
			}[result.error];
			return this.ephemeral(interaction, reason);
		}
		return this.ephemeral(interaction, `✅ made **${result.playlist.name}**. add tracks with \`/playlist add\`.`);
	}

	public async chatInputDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const playlist = await this.authorized(interaction, 'manage');
		if (!playlist) return;
		deletePlaylist(playlist.id);
		return this.ephemeral(interaction, `🗑️ deleted **${playlist.name}**.`);
	}

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const playlist = await this.authorized(interaction, 'create');
		if (!playlist) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		let tracks: NewTrack[];
		try {
			tracks = await resolveTracksForQuery(interaction.options.getString('query', true), interaction.user);
		} catch (e) {
			this.container.logger.error(`[playlist] search: ${String(e)}`);
			return interaction.editReply('something went wrong on my end, check the logs.');
		}
		if (!tracks.length) return interaction.editReply("❌ couldn't find anything for that.");
		return interaction.editReply(this.added(playlist, tracks, interaction.user.id));
	}

	public async chatInputAddCurrent(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const playlist = await this.authorized(interaction, 'create');
		if (!playlist) return;
		const current = currentTrack(interaction.guildId);
		if (!current) return this.ephemeral(interaction, "nothing's playing right now.");
		return this.ephemeral(interaction, this.added(playlist, [toNewTrack(current)], interaction.user.id));
	}

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const playlist = await this.authorized(interaction, 'delete');
		if (!playlist) return;
		const position = interaction.options.getInteger('position', true);
		const track = listTracks(playlist.id)[position - 1];
		if (!track || !removeTrack(playlist.id, track.id)) return this.ephemeral(interaction, `there's no track ${position} in that playlist.`);
		return this.ephemeral(interaction, `🗑️ removed **${track.title}** from **${playlist.name}**.`);
	}

	public async chatInputMove(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const playlist = await this.authorized(interaction, 'update');
		if (!playlist) return;
		const from = interaction.options.getInteger('from', true);
		const to = interaction.options.getInteger('to', true);
		if (!moveTrack(playlist.id, from - 1, to - 1)) return this.ephemeral(interaction, 'both positions need to be in the playlist.');
		return this.ephemeral(interaction, `↕️ moved track ${from} to ${to} in **${playlist.name}**.`);
	}

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const lists = await listVisiblePlaylists(interaction.guild, interaction.user.id);
		const pick = (entries: { playlist: Playlist }[]) => entries.map(({ playlist }) => playlist);

		const embed = new EmbedBuilder()
			.setTitle('📚 Playlists')
			.setColor(0x5865f2)
			.addFields(
				{ name: 'Yours', value: section(pick(lists.owned)) },
				{ name: 'Shared with you', value: section(pick(lists.shared)) },
				{ name: 'Public in this server', value: section(pick(lists.public)) }
			);
		return interaction.editReply({ embeds: [embed] });
	}

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const playlist = await this.authorized(interaction, 'read');
		if (!playlist) return;
		const page = interaction.options.getInteger('page') ?? 1;
		const offset = (page - 1) * PAGE_SIZE;
		const tracks = listTracks(playlist.id).slice(offset, offset + PAGE_SIZE);
		const pages = Math.max(1, Math.ceil(playlist.trackCount / PAGE_SIZE));

		const lines = tracks.map((track) => {
			const title = track.title.length > 60 ? `${track.title.slice(0, 60)}…` : track.title;
			const linked = track.uri ? `[${title}](${track.uri})` : title;
			return `**${track.position + 1}.** ${linked} (${formatDuration(track.lengthMs)})`;
		});
		const empty = playlist.trackCount ? "that's the end of the list." : 'no tracks yet.';

		const embed = new EmbedBuilder()
			.setTitle(`📚 ${playlist.name}`)
			.setColor(0x5865f2)
			.setDescription(
				[playlist.description, describe(playlist), '', ...(lines.length ? lines : [empty])].filter((line) => line !== null).join('\n')
			)
			.setFooter({ text: `Page ${page} of ${pages}` });

		const cover = getCover(playlist.id);
		if (!cover) return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
		const file = `cover.${cover.mime.split('/')[1]}`;
		embed.setThumbnail(`attachment://${file}`);
		return interaction.reply({ embeds: [embed], files: [new AttachmentBuilder(cover.bytes, { name: file })], flags: MessageFlags.Ephemeral });
	}

	public async chatInputPlay(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: OUTSIDE_GUILD, flags: MessageFlags.Ephemeral });
		const voiceChannel = interaction.member.voice.channel;
		if (!voiceChannel) return this.ephemeral(interaction, "hey dumbass, you aren't in a voice channel.");
		const botChannelId = getMusicBotChannelId(interaction.guildId);
		if (botChannelId && botChannelId !== voiceChannel.id)
			return this.ephemeral(interaction, 'get in my voice channel if you want to control the player.');

		const playlist = await this.authorized(interaction, 'read');
		if (!playlist) return;
		await interaction.deferReply();

		const result = await playPlaylist({
			guildId: interaction.guildId,
			member: interaction.member,
			voiceChannelId: voiceChannel.id,
			textChannelId: interaction.channelId,
			interaction,
			playlist,
			shuffle: interaction.options.getBoolean('shuffle') ?? false,
			loop: interaction.options.getBoolean('loop') ?? false,
			repeat: interaction.options.getInteger('repeat') ?? 1
		});
		return interaction.editReply(result.ok ? result.message : `❌ ${result.error}`);
	}

	/** Runs the shared authorization gate, replying on failure. Returns the playlist only when allowed. */
	private async authorized(interaction: GuildInteraction, need: PlaylistRight): Promise<Playlist | null> {
		const value = interaction.options.getString('playlist', true);
		const id = /^\d+$/.test(value) ? Number(value) : NaN;
		const result = Number.isSafeInteger(id) ? await authorizePlaylist(interaction.guild, interaction.user.id, id, need) : null;
		if (!result?.ok) {
			await this.ephemeral(interaction, result?.reason === 'forbidden' ? FORBIDDEN : NOT_FOUND);
			return null;
		}
		return result.playlist;
	}

	private added(playlist: Playlist, tracks: NewTrack[], userId: string): string {
		const result = addTracks(playlist.id, tracks, userId);
		if (!result.ok) return `❌ that would put more than ${MAX_TRACKS_PER_PLAYLIST} tracks in **${playlist.name}**.`;
		const what = tracks.length === 1 ? `**${tracks[0].title}**` : `${tracks.length} tracks`;
		return `✅ added ${what} to **${playlist.name}**.`;
	}

	private async candidates(guild: Guild, userId: string, need: PlaylistRight): Promise<Playlist[]> {
		if (need === 'manage') return listWritablePlaylists(userId, 'create').filter((playlist) => playlist.ownerId === userId);
		if (need !== 'read') return listWritablePlaylists(userId, need);
		const lists = await listVisiblePlaylists(guild, userId);
		return [...lists.owned, ...lists.shared, ...lists.public].map(({ playlist }) => playlist);
	}

	private choiceName(playlist: Playlist, userId: string): string {
		const owner = playlist.ownerId === userId ? null : this.container.client.users.cache.get(playlist.ownerId)?.username;
		return (owner ? `${playlist.name} — ${owner}` : playlist.name).slice(0, 100);
	}

	private ephemeral(interaction: GuildInteraction, content: string) {
		if (interaction.deferred || interaction.replied) return interaction.editReply(content);
		return interaction.reply({ content, flags: MessageFlags.Ephemeral });
	}
}

/** Structural, because discord.js and the Sapphire registry pull in two copies of @discordjs/builders. */
interface StringOptionBuilder<T> {
	setName(name: string): T;
	setDescription(description: string): T;
	setRequired(required: boolean): T;
	setAutocomplete(autocomplete: boolean): T;
}

function playlistOption<T extends StringOptionBuilder<T>>(option: T): T {
	return option.setName('playlist').setDescription('Which playlist').setRequired(true).setAutocomplete(true);
}
