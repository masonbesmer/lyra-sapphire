import { container, Listener } from '@sapphire/framework';
import { MessageFlags, Interaction, GuildMember, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { PaginatedMessage } from '@sapphire/discord.js-utilities';
import { buildPlayerPayload } from '../lib/playerComponents';
import { getCachedMessage } from '../lib/playerMessages';
import { checkDJPermission, cleanTrackTitle, formatDuration, isAutoplayEnabled, repeatModeLabel, applyLoopMode, setAutoplay } from '../lib/music';
import { tryAutoplay } from '../lib/musicAutoplay';
import { FILTER_NAMES, getActiveFilters, applyFilters } from '../lib/lavalinkFilters';
import { fetchLyrics, buildLyricsEmbeds } from '../lib/lyrics';
import { broadcastEvent, broadcastQueueUpdate } from '../lib/websocket';
import { getMusicBotChannelId } from '../lib/voice/musicClient';
import { getMusicConfig } from '../lib/config';
import type { KazagumoTrack } from 'kazagumo';

export class PlayerControlsListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: 'interactionCreate' });
	}

	public async run(interaction: Interaction) {
		if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
		if (!interaction.inCachedGuild()) return;
		if (!interaction.customId.startsWith('player_')) return;

		// The overflow dropdown carries the action as its value, so a menu entry and a button
		// of the same name land on one branch of the switch below.
		const isOptionsSelect = interaction.isStringSelectMenu() && interaction.customId === 'player_options';
		const action = isOptionsSelect ? `player_${interaction.values[0]}` : interaction.customId;

		const member = interaction.member as GuildMember;
		const voice = member.voice.channel;
		const botVoiceId = getMusicBotChannelId(interaction.guildId!);

		if (!voice || !botVoiceId || voice.id !== botVoiceId) {
			return interaction.reply({ content: 'get in my voice channel to use the player controls.', flags: MessageFlags.Ephemeral });
		}

		const player = container.client.kazagumo.getPlayer(interaction.guildId!);
		if (!player) {
			return interaction.reply({ content: "the player's not active anymore.", flags: MessageFlags.Ephemeral });
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
			'player_autoplay',
			'player_autoplay_start',
			'player_restart_queue',
			'player_vol_down',
			'player_vol_up',
			'player_filters',
			'player_filter_select'
		];
		if (destructiveIds.includes(action)) {
			if (!checkDJPermission(member, interaction.guildId!)) {
				return interaction.reply({ content: '🚫 nice try, you need the DJ role for that.', flags: MessageFlags.Ephemeral });
			}
		}

		const updateNowPlaying = async () => {
			const msg = getCachedMessage(interaction.channelId);
			if (msg) {
				const payload = buildPlayerPayload(player, { announce: getMusicConfig(interaction.guildId!).announce_tracks });
				await msg.edit(payload).catch(() => {});
			}
		};

		if (interaction.isStringSelectMenu() && interaction.customId === 'player_filter_select') {
			// The select's `values` on submit is the full checked-state, not a single click -
			// treat it as the new target active set rather than toggling just values[0],
			// otherwise leaving an already-active filter checked while picking another would
			// incorrectly flip it off.
			const active = getActiveFilters(player);
			active.clear();
			for (const value of interaction.values) active.add(value);
			await applyFilters(player);
			await updateNowPlaying();
			broadcastEvent(interaction.guildId!, 'filterChange', { active: [...active] });
			broadcastQueueUpdate(interaction.guildId!);
			return interaction.update({
				content: active.size ? `🎛️ active filters: ${[...active].map((f) => `**${f}**`).join(', ')}.` : '🎛️ cleared all filters.',
				components: []
			});
		}

		// A picked option stays displayed as the dropdown's value until the card is redrawn,
		// so reset it up front - branches that change state redraw again afterwards.
		if (isOptionsSelect) await updateNowPlaying();

		switch (action) {
			case 'player_skip':
				player.skip();
				return interaction.reply({ content: '⏭️ skipped', flags: MessageFlags.Ephemeral });

			case 'player_previous': {
				const prevTrack = player.getPrevious(true);
				if (prevTrack) {
					await player.play(prevTrack);
				} else {
					await player.seek(0);
				}
				await updateNowPlaying();
				return interaction.reply({
					content: prevTrack ? '⏮️ playing the previous track' : '⏮️ restarted the track',
					flags: MessageFlags.Ephemeral
				});
			}

			case 'player_restart': {
				await player.seek(0);
				await updateNowPlaying();
				return interaction.reply({ content: '↩️ back to the start', flags: MessageFlags.Ephemeral });
			}

			case 'player_pause': {
				if (player.paused) {
					player.pause(false);
					await updateNowPlaying();
					broadcastEvent(interaction.guildId!, 'pauseStateChange', { paused: false });
					broadcastQueueUpdate(interaction.guildId!);
					return interaction.reply({ content: '▶️ resumed', flags: MessageFlags.Ephemeral });
				} else {
					player.pause(true);
					await updateNowPlaying();
					broadcastEvent(interaction.guildId!, 'pauseStateChange', { paused: true });
					broadcastQueueUpdate(interaction.guildId!);
					return interaction.reply({ content: '⏸️ paused', flags: MessageFlags.Ephemeral });
				}
			}

			case 'player_stop':
				await player.destroy();
				return interaction.reply({ content: '⏹️ stopped', flags: MessageFlags.Ephemeral });

			case 'player_loop': {
				const modes: Array<'none' | 'track' | 'queue'> = ['none', 'track', 'queue'];
				const next = modes[(modes.indexOf(player.loop) + 1) % modes.length];
				applyLoopMode(player, next);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'loopChange', { mode: next });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `🔁 loop: **${repeatModeLabel(next)}**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_autoplay': {
				const enabled = !isAutoplayEnabled(player);
				setAutoplay(player, enabled);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'loopChange', { mode: enabled ? 'autoplay' : player.loop });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `♾️ autoplay: **${enabled ? 'on' : 'off'}**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_autoplay_start': {
				setAutoplay(player, true);
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const started = await tryAutoplay(player);
				return interaction.followUp({
					content: started
						? '♾️ autoplay is on, picking up from the last track.'
						: "♾️ autoplay is on, but I couldn't find anything to follow with.",
					flags: MessageFlags.Ephemeral
				});
			}

			case 'player_restart_queue': {
				// `previous` is newest-first, so it has to be reversed to replay in play order.
				const previous = [...player.queue.previous].reverse();
				if (!previous.length) {
					return interaction.reply({ content: "nothing's been played yet to restart.", flags: MessageFlags.Ephemeral });
				}

				player.queue.add(previous);
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				await player.play();
				return interaction.followUp({ content: `🔂 replaying ${previous.length} track(s)`, flags: MessageFlags.Ephemeral });
			}

			case 'player_shuffle':
				player.queue.shuffle();
				await updateNowPlaying();
				return interaction.reply({ content: `🔀 shuffled ${player.queue.size} tracks`, flags: MessageFlags.Ephemeral });

			case 'player_queue': {
				const tracks = [...player.queue] as KazagumoTrack[];
				const lines = tracks.slice(0, 10).map((t, i) => `**${i + 1}.** ${t.title} — ${formatDuration(t.length ?? 0)}`);
				if (tracks.length > 10) lines.push(`…and ${tracks.length - 10} more`);
				return interaction.reply({
					content: lines.length ? `📋 **Up next**\n${lines.join('\n')}` : '📋 nothing queued after this one.',
					flags: MessageFlags.Ephemeral
				});
			}

			case 'player_vol_down': {
				const vol = Math.max(player.volume - 10, 1);
				await player.setVolume(vol);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'volumeChange', { volume: vol });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `🔉 volume: **${vol}%**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_vol_up': {
				const vol = Math.min(player.volume + 10, 100);
				await player.setVolume(vol);
				await updateNowPlaying();
				broadcastEvent(interaction.guildId!, 'volumeChange', { volume: vol });
				broadcastQueueUpdate(interaction.guildId!);
				return interaction.reply({ content: `🔊 volume: **${vol}%**`, flags: MessageFlags.Ephemeral });
			}

			case 'player_lyrics': {
				const track = player.queue.current;
				if (!track) return interaction.reply({ content: "nothing's playing.", flags: MessageFlags.Ephemeral });

				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const query = cleanTrackTitle(track.title);
				const lyrics = await fetchLyrics(query);
				if (!lyrics) return interaction.followUp({ content: `couldn't find lyrics for **${query}**.`, flags: MessageFlags.Ephemeral });

				const paginatedMessage = new PaginatedMessage();
				for (const embed of buildLyricsEmbeds(query, lyrics)) {
					paginatedMessage.addPageEmbed(embed);
				}
				await paginatedMessage.run(interaction, interaction.user);
				return;
			}

			case 'player_filters': {
				const active = getActiveFilters(player);
				const options = FILTER_NAMES.slice(0, 25).map((f) =>
					new StringSelectMenuOptionBuilder()
						.setLabel(f)
						.setValue(f)
						.setDescription(active.has(f) ? '✅ Active' : 'Inactive')
						.setDefault(active.has(f))
				);
				// max_values must cover every option that can be pre-checked as a default,
				// i.e. however many filters are simultaneously active - otherwise Discord
				// rejects the whole component once 2+ filters are active (COMPONENT_TOO_MANY_DEFAULT_VALUES).
				const select = new StringSelectMenuBuilder()
					.setCustomId('player_filter_select')
					.setPlaceholder('Toggle filters...')
					.setMinValues(0)
					.setMaxValues(options.length)
					.addOptions(options);
				const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
				return interaction.reply({ content: '🎛️ pick filters to toggle:', components: [row], flags: MessageFlags.Ephemeral });
			}

			default:
				return;
		}
	}
}
