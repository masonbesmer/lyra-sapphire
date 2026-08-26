import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, Message } from 'discord.js';
import { FILTER_NAMES, EQ_PRESET_NAMES, buildEQPreset, toggleFilter, clearFilters, getActiveFilters } from '../../lib/lavalinkFilters';
import { broadcastEvent, broadcastQueueUpdate } from '../../lib/websocket';

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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "there's no active queue.", flags: MessageFlags.Ephemeral });

		const active = getActiveFilters(player);
		const lines = FILTER_NAMES.map((f) => `${active.has(f) ? '✅' : '⬜'} \`${f}\``);
		return interaction.reply({ content: `**Available Filters:**\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
	}

	public async messageList(message: Message, _args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("there's no active queue.");

		const active = getActiveFilters(player);
		const lines = FILTER_NAMES.map((f) => `${active.has(f) ? '✅' : '⬜'} \`${f}\``);
		return message.reply(`**Available Filters:**\n${lines.join('\n')}`);
	}

	// ── /filter toggle ────────────────────────────────────────────────────────

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "there's no active queue.", flags: MessageFlags.Ephemeral });

		const filterName = interaction.options.getString('filter', true);
		if (!FILTER_NAMES.includes(filterName)) {
			return interaction.reply({ content: `never heard of \`${filterName}\`.`, flags: MessageFlags.Ephemeral });
		}

		const isOn = await toggleFilter(player, filterName);
		broadcastEvent(interaction.guildId, 'filterChange', { active: [...getActiveFilters(player)] });
		broadcastQueueUpdate(interaction.guildId);
		return interaction.reply({ content: `🎛️ **${filterName}** is now ${isOn ? '✅ on' : '⬜ off'}` });
	}

	public async messageToggle(message: Message, args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("there's no active queue.");

		const filterName = await args.pick('string').catch(() => null);
		if (!filterName) return message.reply('give me a filter name. example: `%filter toggle bassboost`');
		if (!FILTER_NAMES.includes(filterName)) {
			return message.reply(`never heard of \`${filterName}\`. use \`%filter list\` to see what's available.`);
		}

		const isOn = await toggleFilter(player, filterName);
		broadcastEvent(message.guildId, 'filterChange', { active: [...getActiveFilters(player)] });
		broadcastQueueUpdate(message.guildId);
		return message.reply(`🎛️ **${filterName}** is now ${isOn ? '✅ on' : '⬜ off'}`);
	}

	// ── /filter preset ────────────────────────────────────────────────────────

	public async chatInputPreset(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "there's no active queue.", flags: MessageFlags.Ephemeral });

		const name = interaction.options.getString('name', true);
		const filterOpts = buildEQPreset(name);
		if (!filterOpts) return interaction.reply({ content: `never heard of the \`${name}\` preset.`, flags: MessageFlags.Ephemeral });

		await player.shoukaku.setFilters(filterOpts);
		broadcastEvent(interaction.guildId, 'filterChange', { preset: name });
		broadcastQueueUpdate(interaction.guildId);
		return interaction.reply({ content: `🎚️ EQ preset **${name}** applied.` });
	}

	public async messagePreset(message: Message, args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("there's no active queue.");

		const name = await args.pick('string').catch(() => null);
		if (!name) return message.reply(`give me a preset name. available: ${EQ_PRESET_NAMES.join(', ')}`);
		const filterOpts = buildEQPreset(name);
		if (!filterOpts) return message.reply(`never heard of \`${name}\`. available: ${EQ_PRESET_NAMES.join(', ')}`);

		await player.shoukaku.setFilters(filterOpts);
		broadcastEvent(message.guildId, 'filterChange', { preset: name });
		broadcastQueueUpdate(message.guildId);
		return message.reply(`🎚️ EQ preset **${name}** applied.`);
	}

	// ── /filter clear ─────────────────────────────────────────────────────────

	public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const player = this.container.client.kazagumo.getPlayer(interaction.guildId);
		if (!player) return interaction.reply({ content: "there's no active queue.", flags: MessageFlags.Ephemeral });

		await clearFilters(player);
		broadcastEvent(interaction.guildId, 'filterChange', { active: [] });
		broadcastQueueUpdate(interaction.guildId);
		return interaction.reply('🎛️ cleared all filters.');
	}

	public async messageClear(message: Message, _args: Args) {
		if (!message.guildId) return message.reply("can't do that outside a server.");
		const player = this.container.client.kazagumo.getPlayer(message.guildId);
		if (!player) return message.reply("there's no active queue.");

		await clearFilters(player);
		broadcastEvent(message.guildId, 'filterChange', { active: [] });
		broadcastQueueUpdate(message.guildId);
		return message.reply('🎛️ cleared all filters.');
	}
}
