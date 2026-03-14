import { container, Listener } from '@sapphire/framework';
import { ButtonInteraction, GuildMember, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { buildPlayerRows } from '../lib/playerButtons';
import { getCachedMessage } from '../lib/playerMessages';
import { buildNowPlayingEmbed, checkDJPermission, repeatModeLabel } from '../lib/music';
import { FILTER_NAMES, getActiveFilters, toggleFilter } from '../lib/lavalinkFilters';

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

		const player = container.client.kazagumo.getPlayer(interaction.guildId!);
		if (!player) return;

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
				const embed = buildNowPlayingEmbed(player);
				const rows = buildPlayerRows(player);
				await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
			}
		};

		if (interaction.isStringSelectMenu() && interaction.customId === 'player_filter_select') {
			const filterName = interaction.values[0];
			await toggleFilter(player, filterName);
			await updateNowPlaying();
			return interaction.update({ content: `🎛️ Filter **${filterName}** toggled.`, components: [] });
		}

		if (!interaction.isButton()) return;

		switch (interaction.customId) {
			case 'player_skip':
				player.skip();
				await updateNowPlaying();
				return interaction.reply({ content: '⏭️ Skipped', ephemeral: true });

			case 'player_previous':
				await player.seek(0);
				await updateNowPlaying();
				return interaction.reply({ content: '⏮️ Restarted track', ephemeral: true });

			case 'player_pause': {
				if (player.paused) {
					player.pause(false);
					await updateNowPlaying();
					return interaction.reply({ content: '▶️ Resumed', ephemeral: true });
				} else {
					player.pause(true);
					await updateNowPlaying();
					return interaction.reply({ content: '⏸️ Paused', ephemeral: true });
				}
			}

			case 'player_stop':
				await player.destroy();
				return interaction.reply({ content: '⏹️ Stopped', ephemeral: true });

			case 'player_loop': {
				const modes: Array<'none' | 'track' | 'queue'> = ['none', 'track', 'queue'];
				const next = modes[(modes.indexOf(player.loop) + 1) % modes.length];
				player.setLoop(next);
				await updateNowPlaying();
				return interaction.reply({ content: `🔁 Loop: **${repeatModeLabel(next)}**`, ephemeral: true });
			}

			case 'player_shuffle':
				player.queue.shuffle();
				await updateNowPlaying();
				return interaction.reply({ content: `🔀 Shuffled ${player.queue.size} tracks`, ephemeral: true });

			case 'player_vol_down': {
				const vol = Math.max(player.volume - 10, 1);
				await player.setVolume(vol);
				await updateNowPlaying();
				return interaction.reply({ content: `🔉 Volume: **${vol}%**`, ephemeral: true });
			}

			case 'player_vol_up': {
				const vol = Math.min(player.volume + 10, 100);
				await player.setVolume(vol);
				await updateNowPlaying();
				return interaction.reply({ content: `🔊 Volume: **${vol}%**`, ephemeral: true });
			}

			case 'player_lyrics': {
				const track = player.queue.current;
				if (!track) return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
				return interaction.reply({ content: `Use \`/lyrics\` to fetch lyrics for **${track.title}**.`, ephemeral: true });
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
				return interaction.reply({ content: '🎛️ Select a filter to toggle:', components: [row], ephemeral: true });
			}

			case 'player_seek_forward':
				await player.seek(player.position + 10000);
				return interaction.reply({ content: '⏩ Forward 10s', ephemeral: true });
			case 'player_seek_back':
				await player.seek(Math.max(player.position - 10000, 0));
				return interaction.reply({ content: '⏪ Back 10s', ephemeral: true });

			default:
				return;
		}
	}
}
