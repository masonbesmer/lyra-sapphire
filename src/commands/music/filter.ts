import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { useMainPlayer } from 'discord-player';
import { Message } from 'discord.js';

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
	'chorus2d',
	'chorus3d',
	'fadein',
	'dim',
	'softlimiter',
	'compressor',
	'expander',
	'silenceremove'
] as const;

type FFmpegFilter = (typeof FFMPEG_FILTERS)[number];

const EQ_PRESETS = [
	'Flat',
	'Classical',
	'Club',
	'Dance',
	'FullBass',
	'FullBassTreble',
	'FullTreble',
	'Headphones',
	'LargeHall',
	'Live',
	'Party',
	'Pop',
	'Reggae',
	'Rock',
	'Ska',
	'Soft',
	'SoftRock',
	'Techno'
] as const;

@ApplyOptions<Subcommand.Options>({
	name: 'filter',
	description: 'Manage audio filters',
	preconditions: ['InVoiceWithBot', 'DJOnly'],
	subcommands: [
		{ name: 'list', chatInputRun: 'chatInputList', messageRun: 'messageList' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle', messageRun: 'messageToggle' },
		{ name: 'preset', chatInputRun: 'chatInputPreset', messageRun: 'messagePreset' },
		{ name: 'clear', chatInputRun: 'chatInputClear', messageRun: 'messageClear' }
	]
})
export class FilterCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) => sub.setName('list').setDescription('Show available filters and which are active'))
				.addSubcommand((sub) =>
					sub
						.setName('toggle')
						.setDescription('Toggle an FFmpeg filter on/off')
						.addStringOption((o) =>
							o.setName('filter').setDescription('Filter name').setRequired(true).setAutocomplete(true)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('preset')
						.setDescription('Apply an EQ preset')
						.addStringOption((o) =>
							o.setName('name').setDescription('Preset name').setRequired(true).setAutocomplete(true)
						)
				)
				.addSubcommand((sub) => sub.setName('clear').setDescription('Disable all active filters'))
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		if (focused.name === 'filter') {
			const query = focused.value.toLowerCase();
			const matches = FFMPEG_FILTERS.filter((f) => f.includes(query)).slice(0, 25);
			return interaction.respond(matches.map((f) => ({ name: f, value: f })));
		}
		if (focused.name === 'name') {
			const query = focused.value.toLowerCase();
			const matches = EQ_PRESETS.filter((p) => p.toLowerCase().includes(query)).slice(0, 25);
			return interaction.respond(matches.map((p) => ({ name: p, value: p })));
		}
		return interaction.respond([]);
	}

	// ── /filter list ──────────────────────────────────────────────────────────

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const active = (queue.filters.ffmpeg.filters ?? []) as string[];
		const lines = FFMPEG_FILTERS.map((f) => `${active.includes(f) ? '✅' : '⬜'} \`${f}\``);
		return interaction.reply({ content: `**Available Filters:**\n${lines.join('\n')}`, ephemeral: true });
	}

	public async messageList(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		const active = (queue.filters.ffmpeg.filters ?? []) as string[];
		const lines = FFMPEG_FILTERS.map((f) => `${active.includes(f) ? '✅' : '⬜'} \`${f}\``);
		return message.reply(`**Available Filters:**\n${lines.join('\n')}`);
	}

	// ── /filter toggle ────────────────────────────────────────────────────────

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const filter = interaction.options.getString('filter', true) as FFmpegFilter;
		if (!(FFMPEG_FILTERS as readonly string[]).includes(filter)) {
			return interaction.reply({ content: `Unknown filter: \`${filter}\``, ephemeral: true });
		}

		await queue.filters.ffmpeg.toggle(filter);
		const active = (queue.filters.ffmpeg.filters ?? []) as string[];
		const isOn = active.includes(filter);
		return interaction.reply({ content: `🎛️ **${filter}** is now ${isOn ? '✅ on' : '⬜ off'}`, ephemeral: false });
	}

	public async messageToggle(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		const filter = await args.pick('string').catch(() => null);
		if (!filter) return message.reply('Please provide a filter name. Example: `%filter toggle bassboost`');
		if (!(FFMPEG_FILTERS as readonly string[]).includes(filter)) {
			return message.reply(`Unknown filter: \`${filter}\`. Use \`%filter list\` to see available filters.`);
		}

		await queue.filters.ffmpeg.toggle(filter as FFmpegFilter);
		const active = (queue.filters.ffmpeg.filters ?? []) as string[];
		const isOn = active.includes(filter);
		return message.reply(`🎛️ **${filter}** is now ${isOn ? '✅ on' : '⬜ off'}`);
	}

	// ── /filter preset ────────────────────────────────────────────────────────

	public async chatInputPreset(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const name = interaction.options.getString('name', true);
		if (!(EQ_PRESETS as readonly string[]).includes(name)) {
			return interaction.reply({ content: `Unknown preset: \`${name}\``, ephemeral: true });
		}

		await queue.filters.equalizer?.setEQ(name as any);
		return interaction.reply({ content: `🎚️ Applied EQ preset: **${name}**` });
	}

	public async messagePreset(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		const name = await args.pick('string').catch(() => null);
		if (!name) return message.reply(`Please provide a preset name. Available: ${EQ_PRESETS.join(', ')}`);
		if (!(EQ_PRESETS as readonly string[]).includes(name)) {
			return message.reply(`Unknown preset: \`${name}\`. Available: ${EQ_PRESETS.join(', ')}`);
		}

		await queue.filters.equalizer?.setEQ(name as any);
		return message.reply(`🎚️ Applied EQ preset: **${name}**`);
	}

	// ── /filter clear ─────────────────────────────────────────────────────────

	public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = useMainPlayer();
		const queue = player.nodes.get(interaction.guild);
		if (!queue) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		await queue.filters.ffmpeg.setFilters({});
		return interaction.reply('🎛️ All filters cleared.');
	}

	public async messageClear(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue) return message.reply('There is no active queue.');

		await queue.filters.ffmpeg.setFilters({});
		return message.reply('🎛️ All filters cleared.');
	}
}
