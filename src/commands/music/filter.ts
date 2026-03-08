import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { Message } from 'discord.js';
import { FILTER_NAMES, EQ_PRESET_NAMES, buildEQPreset, toggleFilter, clearFilters, getActiveFilters } from '../../lib/lavalinkFilters';

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
						.setDescription('Toggle a Lavalink filter on/off')
						.addStringOption((o) => o.setName('filter').setDescription('Filter name').setRequired(true).setAutocomplete(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('preset')
						.setDescription('Apply an EQ preset')
						.addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true).setAutocomplete(true))
				)
				.addSubcommand((sub) => sub.setName('clear').setDescription('Disable all active filters'))
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		const focused = interaction.options.getFocused(true);
		if (focused.name === 'filter') {
			const query = focused.value.toLowerCase();
			const matches = FILTER_NAMES.filter((f) => f.includes(query)).slice(0, 25);
			return interaction.respond(matches.map((f) => ({ name: f, value: f })));
		}
		if (focused.name === 'name') {
			const query = focused.value.toLowerCase();
			const matches = EQ_PRESET_NAMES.filter((p) => p.toLowerCase().includes(query)).slice(0, 25);
			return interaction.respond(matches.map((p) => ({ name: p, value: p })));
		}
		return interaction.respond([]);
	}

	// ── /filter list ──────────────────────────────────────────────────────────

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const active = getActiveFilters(player);
		const lines = FILTER_NAMES.map((f) => `${active.has(f) ? '✅' : '⬜'} \`${f}\``);
		return interaction.reply({ content: `**Available Filters:**\n${lines.join('\n')}`, ephemeral: true });
	}

	public async messageList(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('There is no active queue.');

		const active = getActiveFilters(player);
		const lines = FILTER_NAMES.map((f) => `${active.has(f) ? '✅' : '⬜'} \`${f}\``);
		return message.reply(`**Available Filters:**\n${lines.join('\n')}`);
	}

	// ── /filter toggle ────────────────────────────────────────────────────────

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const filterName = interaction.options.getString('filter', true);
		if (!FILTER_NAMES.includes(filterName)) {
			return interaction.reply({ content: `Unknown filter: \`${filterName}\``, ephemeral: true });
		}

		const isOn = await toggleFilter(player, filterName);
		return interaction.reply({ content: `🎛️ **${filterName}** is now ${isOn ? '✅ on' : '⬜ off'}`, ephemeral: false });
	}

	public async messageToggle(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('There is no active queue.');

		const filterName = await args.pick('string').catch(() => null);
		if (!filterName) return message.reply('Please provide a filter name. Example: `%filter toggle bassboost`');
		if (!FILTER_NAMES.includes(filterName)) {
			return message.reply(`Unknown filter: \`${filterName}\`. Use \`%filter list\` to see available filters.`);
		}

		const isOn = await toggleFilter(player, filterName);
		return message.reply(`🎛️ **${filterName}** is now ${isOn ? '✅ on' : '⬜ off'}`);
	}

	// ── /filter preset ────────────────────────────────────────────────────────

	public async chatInputPreset(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		const name = interaction.options.getString('name', true);
		const filterOpts = buildEQPreset(name);
		if (!filterOpts) return interaction.reply({ content: `Unknown preset: \`${name}\``, ephemeral: true });

		await player.shoukaku.setFilters(filterOpts);
		return interaction.reply({ content: `🎚️ Applied EQ preset: **${name}**` });
	}

	public async messagePreset(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('There is no active queue.');

		const name = await args.pick('string').catch(() => null);
		if (!name) return message.reply(`Please provide a preset name. Available: ${EQ_PRESET_NAMES.join(', ')}`);
		const filterOpts = buildEQPreset(name);
		if (!filterOpts) return message.reply(`Unknown preset: \`${name}\`. Available: ${EQ_PRESET_NAMES.join(', ')}`);

		await player.shoukaku.setFilters(filterOpts);
		return message.reply(`🎚️ Applied EQ preset: **${name}**`);
	}

	// ── /filter clear ─────────────────────────────────────────────────────────

	public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: 'There is no active queue.', ephemeral: true });

		await clearFilters(player);
		return interaction.reply('🎛️ All filters cleared.');
	}

	public async messageClear(message: Message, _args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply('There is no active queue.');

		await clearFilters(player);
		return message.reply('🎛️ All filters cleared.');
	}
}
