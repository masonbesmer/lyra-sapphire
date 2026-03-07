import { Listener } from '@sapphire/framework';
import { ButtonInteraction, GuildMember, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { QueueRepeatMode, useMainPlayer } from 'discord-player';
import { buildPlayerRows } from '../lib/playerButtons';
import { getCachedMessage } from '../lib/playerMessages';
import { buildNowPlayingEmbed, checkDJPermission, repeatModeLabel } from '../lib/music';

const FFMPEG_FILTERS = [
	'bassboost_low',
	'bassboost',
	'bassboost_high',
	'8D',
	'vaporwave',
	'nightcore',
	'phaser',
	'tremolo',
	'vibrato',
	'reverse',
	'treble',
	'normalizer',
	'surrounding',
	'pulsator',
	'subboost',
	'karaoke',
	'flanger',
	'gate',
	'haas',
	'mcompand',
	'lofi',
	'earrape',
	'chorus',
	'fadein',
	'dim',
	'softlimiter',
	'compressor',
	'expander',
	'silenceremove'
];

export class PlayerControlsListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: 'interactionCreate' });
	}

	public async run(interaction: ButtonInteraction) {
		if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
		if (!interaction.inCachedGuild()) return;
		if (!interaction.customId.startsWith('player_')) return;

		const member = interaction.member as GuildMember;
		const voice = member.voice.channel;
		const botVoice = interaction.guild.members.me?.voice.channel;

		if (!voice || !botVoice || voice.id !== botVoice.id) {
			return interaction.reply({ content: 'Join my voice channel to use the player controls.', ephemeral: true });
		}

		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guildId!);
		if (!queue) return;

		// DJ check for destructive actions
		const destructiveIds = ['player_skip', 'player_stop', 'player_shuffle', 'player_loop', 'player_vol_down', 'player_vol_up', 'player_filters'];
		if (destructiveIds.includes(interaction.customId)) {
			if (!checkDJPermission(member, interaction.guildId!)) {
				return interaction.reply({ content: '🚫 You need the DJ role to use this control.', ephemeral: true });
			}
		}

		const updateNowPlaying = async () => {
			const msg = getCachedMessage(interaction.channelId);
			if (msg) {
				const embed = buildNowPlayingEmbed(queue);
				const rows = buildPlayerRows(queue);
				await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
			}
		};

		if (interaction.isStringSelectMenu() && interaction.customId === 'player_filter_select') {
			const filter = interaction.values[0] as any;
			await queue.filters.ffmpeg.toggle(filter);
			await updateNowPlaying();
			return interaction.update({ content: `🎛️ Filter **${filter}** toggled.`, components: [] });
		}

		if (!interaction.isButton()) return;

		switch (interaction.customId) {
			case 'player_skip':
				queue.node.skip();
				await updateNowPlaying();
				return interaction.reply({ content: '⏭️ Skipped', ephemeral: true });

			case 'player_previous':
				await queue.node.seek(0);
				await updateNowPlaying();
				return interaction.reply({ content: '⏮️ Restarted track', ephemeral: true });

			case 'player_pause': {
				if (queue.node.isPaused()) {
					queue.node.resume();
					await updateNowPlaying();
					return interaction.reply({ content: '▶️ Resumed', ephemeral: true });
				} else {
					queue.node.pause();
					await updateNowPlaying();
					return interaction.reply({ content: '⏸️ Paused', ephemeral: true });
				}
			}

			case 'player_stop':
				queue.delete();
				return interaction.reply({ content: '⏹️ Stopped', ephemeral: true });

			case 'player_loop': {
				const modes = [QueueRepeatMode.OFF, QueueRepeatMode.TRACK, QueueRepeatMode.QUEUE, QueueRepeatMode.AUTOPLAY];
				const next = modes[(modes.indexOf(queue.repeatMode) + 1) % modes.length];
				queue.setRepeatMode(next);
				await updateNowPlaying();
				return interaction.reply({ content: `🔁 Loop: **${repeatModeLabel(next)}**`, ephemeral: true });
			}

			case 'player_shuffle':
				queue.tracks.shuffle();
				await updateNowPlaying();
				return interaction.reply({ content: `🔀 Shuffled ${queue.tracks.size} tracks`, ephemeral: true });

			case 'player_vol_down': {
				const vol = Math.max(queue.node.volume - 10, 1);
				queue.node.setVolume(vol);
				await updateNowPlaying();
				return interaction.reply({ content: `🔉 Volume: **${vol}%**`, ephemeral: true });
			}

			case 'player_vol_up': {
				const vol = Math.min(queue.node.volume + 10, 100);
				queue.node.setVolume(vol);
				await updateNowPlaying();
				return interaction.reply({ content: `🔊 Volume: **${vol}%**`, ephemeral: true });
			}

			case 'player_lyrics': {
				const track = queue.currentTrack;
				if (!track) return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
				return interaction.reply({ content: `Use \`/lyrics\` to fetch lyrics for **${track.title}**.`, ephemeral: true });
			}

			case 'player_filters': {
				const active = (queue.filters.ffmpeg.filters ?? []) as string[];
				const select = new StringSelectMenuBuilder()
					.setCustomId('player_filter_select')
					.setPlaceholder('Toggle a filter...')
					.addOptions(
						FFMPEG_FILTERS.slice(0, 25).map((f) =>
							new StringSelectMenuOptionBuilder()
								.setLabel(f)
								.setValue(f)
								.setDescription(active.includes(f) ? '✅ Active' : 'Inactive')
								.setDefault(active.includes(f))
						)
					);
				const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
				return interaction.reply({ content: '🎛️ Select a filter to toggle:', components: [row], ephemeral: true });
			}

			// Legacy support
			case 'player_repeat': {
				const newMode = queue.repeatMode === QueueRepeatMode.TRACK ? QueueRepeatMode.OFF : QueueRepeatMode.TRACK;
				queue.setRepeatMode(newMode);
				return interaction.reply({
					content: newMode === QueueRepeatMode.TRACK ? '🔂 Repeat enabled' : '🔂 Repeat disabled',
					ephemeral: true
				});
			}
			case 'player_seek_forward':
				await queue.node.seek(queue.node.streamTime + 10000);
				return interaction.reply({ content: '⏩ Forward 10s', ephemeral: true });
			case 'player_seek_back':
				await queue.node.seek(Math.max(queue.node.streamTime - 10000, 0));
				return interaction.reply({ content: '⏪ Back 10s', ephemeral: true });

			default:
				return;
		}
	}
}
