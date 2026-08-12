import { container, Listener } from '@sapphire/framework';
import { MessageFlags, Interaction, GuildMember, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { buildPlayerRows } from '../lib/playerButtons';
import { getCachedMessage } from '../lib/playerMessages';
import { buildNowPlayingEmbed, checkDJPermission, cleanTrackTitle, repeatModeLabel, applyLoopMode } from '../lib/music';
import { FILTER_NAMES, getActiveFilters, toggleFilter } from '../lib/lavalinkFilters';
import { fetchLyrics, buildLyricsEmbeds } from '../lib/lyrics';
import { broadcastEvent, broadcastQueueUpdate } from '../lib/websocket';

export class PlayerControlsListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: 'interactionCreate' });
	}

	public async run(interaction: Interaction) {
		if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
		if (!interaction.inCachedGuild()) return;
		if (!interaction.customId.startsWith('player_')) return;

		const member = interaction.member as GuildMember;
		const voice = member.voice.channel;
		const botVoice = interaction.guild.members.me?.voice.channel;

		if (!voice || !botVoice || voice.id !== botVoice.id) {
			return interaction.reply({ content: 'Join my voice channel to use the player controls.', flags: MessageFlags.Ephemeral });
		}

		const player = container.client.kazagumo.getPlayer(interaction.guildId!);
		if (!player) {
			return interaction.reply({ content: 'The player is no longer active.', flags: MessageFlags.Ephemeral });
		}

		// DJ check for destructive actions. The line is "destroys queue state", not
		// "disrupts playback for everyone" - player_pause and player_previous are
		// deliberately excluded, consistent with /pause and /seek having no DJOnly
		// precondition on the Discord-command side either (see D16).
		const destructiveIds = [
			'player_skip',
			'player_stop',
			'player_shuffle',
			'player_loop',
			'player_vol_down',
			'player_vol_up',
			'player_filters',
			'player_filter_select'
		];
		if (destructiveIds.includes(interaction.customId)) {
			if (!checkDJPermission(member, interaction.guildId!)) {
				return interaction.reply({ content: '🚫 You need the DJ role to use this control.', flags: MessageFlags.Ephemeral });
			}
		}

		const updateNowPlaying = async () => {
			const msg = getCachedMessage(interaction.channelId);
			if (msg) {
				const embed = buildNowPlayingEmbed(player);
				const rows = buildPlayerRows(player);
				await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
			}
		};

		if (interaction.isStringSelectMenu() && interaction.customId === 'player_filter_select') {
			const filterName = interaction.values[0];
			await toggleFilter(player, filterName);
			await updateNowPlaying();
			broadcastEvent(interaction.guildId!, 'filterChange', { active: [...getActiveFilters(player)] });
			broadcastQueueUpdate(interaction.guildId!);
			return interaction.update({ content: `🎛️ Filter **${filterName}** toggled.`, components: [] });
		}

		if (!interaction.isButton()) return;

		switch (interaction.customId) {
			case 'player_skip':
				player.skip();
				return interaction.reply({ content: '⏭️ Skipped', flags: MessageFlags.Ephemeral });

			case 'player_previous':
				await player.seek(0);
				await updateNowPlaying();
				return interaction.reply({ content: '⏮️ Restarted track', flags: MessageFlags.Ephemeral });

			case 'player_pause': {
				if (player.paused) {
					player.pause(false);
					await updateNowPlaying();
					broadcastEvent(interaction.guildId!, 'pauseStateChange', { paused: false });
					broadcastQueueUpdate(interaction.guildId!);
					return interaction.reply({ content: '▶️ Resumed', flags: MessageFlags.Ephemeral });
				} else {
					player.pause(true);
					await updateNowPlaying();
					broadcastEvent(interaction.guildId!, 'pauseStateChange', { paused: true });
					broadcastQueueUpdate(interaction.guildId!);
					return interaction.reply({ content: '⏸️ Paused', flags: MessageFlags.Ephemeral });
				}
			}

			case 'player_stop':
				await player.destroy();
				return interaction.reply({ content: '⏹️ Stopped', flags: MessageFlags.Ephemeral });

			case 'player_loop': {
				const modes: Array<'none' | 'track' | 'queue'> = ['none', 'track', 'queue'];
				const next = modes[(modes.indexOf(player.loop) + 1) % modes.length];
				applyLoopMode(player, next);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'loopChange', { mode: next });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `🔁 Loop: **${repeatModeLabel(next)}**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_shuffle':
				player.queue.shuffle();
				await updateNowPlaying();
				return interaction.reply({ content: `🔀 Shuffled ${player.queue.size} tracks`, flags: MessageFlags.Ephemeral });

			case 'player_vol_down': {
				const vol = Math.max(player.volume - 10, 1);
				await player.setVolume(vol);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'volumeChange', { volume: vol });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `🔉 Volume: **${vol}%**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_vol_up': {
				const vol = Math.min(player.volume + 10, 100);
				await player.setVolume(vol);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'volumeChange', { volume: vol });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `🔊 Volume: **${vol}%**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_lyrics': {
				const track = player.queue.current;
				if (!track) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });

				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const query = cleanTrackTitle(track.title);
				const lyrics = await fetchLyrics(query);
				if (!lyrics) return interaction.followUp({ content: `No lyrics found for **${query}**.`, flags: MessageFlags.Ephemeral });

				const paginatedMessage = new PaginatedMessage();
				for (const embed of buildLyricsEmbeds(query, lyrics)) {
					paginatedMessage.addPageEmbed(embed);
				}
				await paginatedMessage.run(interaction, interaction.user);
				return;
			}

			case 'player_filters': {
				const active = getActiveFilters(player);
				const select = new StringSelectMenuBuilder()
					.setCustomId('player_filter_select')
					.setPlaceholder('Toggle a filter...')
					.addOptions(
						FILTER_NAMES.slice(0, 25).map((f) =>
							new StringSelectMenuOptionBuilder()
								.setLabel(f)
								.setValue(f)
								.setDescription(active.has(f) ? '✅ Active' : 'Inactive')
								.setDefault(active.has(f))
						)
					);
				const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
				return interaction.reply({ content: '🎛️ Select a filter to toggle:', components: [row], flags: MessageFlags.Ephemeral });
			}

			default:
				return;
		}
	}
}
