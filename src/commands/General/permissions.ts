import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, EmbedBuilder, PermissionFlagsBits, type Message } from 'discord.js';
import { deleteCommandPermission, getCommandPermissions, setCommandPermission } from '../../lib/config';
import {
	getGatesForPath,
	isPermissionTarget,
	isUnderPermissionsCommand,
	listPermissionTargets,
	normalizeCommandPath
} from '../../lib/commandPermissions';

const AUTOCOMPLETE_LIMIT = 25;

interface PathOptionBuilder<T> {
	setName(name: string): T;
	setDescription(description: string): T;
	setRequired(required: boolean): T;
	setAutocomplete(autocomplete: boolean): T;
}

// Structural, because the registry and discord.js resolve two copies of @discordjs/builders.
const commandPathOption = <T extends PathOptionBuilder<T>>(opt: T): T =>
	opt.setName('command').setDescription('Command or subcommand, e.g. keyword add').setRequired(true).setAutocomplete(true);

@ApplyOptions<Subcommand.Options>({
	name: 'permissions',
	description: 'Manage command role requirements for this server (admins only)',
	preconditions: [],
	requiredUserPermissions: [PermissionFlagsBits.Administrator],
	subcommands: [
		{ name: 'set', chatInputRun: 'chatInputSet', messageRun: 'messageSet' },
		{ name: 'remove', chatInputRun: 'chatInputRemove', messageRun: 'messageRemove' },
		{ name: 'list', chatInputRun: 'chatInputList', messageRun: 'messageList' },
		{ name: 'check', chatInputRun: 'chatInputCheck', messageRun: 'messageCheck' }
	]
})
export class PermissionsCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription('Set role requirement for a command or subcommand')
						.addStringOption(commandPathOption)
						.addRoleOption((opt) => opt.setName('role').setDescription('Required role').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub.setName('remove').setDescription('Remove role requirement from a command or subcommand').addStringOption(commandPathOption)
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List all command permissions'))
				.addSubcommand((sub) =>
					sub.setName('check').setDescription('Check every role requirement on a command or subcommand').addStringOption(commandPathOption)
				)
		);
	}

	public override async autocompleteRun(interaction: Subcommand.AutocompleteInteraction) {
		const query = normalizeCommandPath(interaction.options.getFocused());
		// remove offers what is stored, so a row whose command has since gone away can still be cleared.
		const candidates =
			interaction.options.getSubcommand() === 'remove' && interaction.guildId
				? getCommandPermissions(interaction.guildId).map((perm) => perm.command_name)
				: listPermissionTargets(this.container.stores.get('commands').values());
		const matches = candidates.filter((path) => path.includes(query)).slice(0, AUTOCOMPLETE_LIMIT);
		return interaction.respond(matches.map((path) => ({ name: path, value: path })));
	}

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: "❌ can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const path = normalizeCommandPath(interaction.options.getString('command', true));
		const role = interaction.options.getRole('role', true);

		if (isUnderPermissionsCommand(path)) {
			return interaction.reply({ content: '❌ /permissions is always Administrator-only.', flags: MessageFlags.Ephemeral });
		}
		if (!isPermissionTarget(path)) {
			return interaction.reply({ content: `❌ no command or subcommand called \`${path}\`.`, flags: MessageFlags.Ephemeral });
		}

		try {
			setCommandPermission(interaction.guildId, path, role.id);
			return interaction.reply({ content: `✅ \`${path}\` now needs **${role.name}**.`, flags: MessageFlags.Ephemeral });
		} catch (error) {
			return interaction.reply({ content: `❌ failed to set that permission: ${error}`, flags: MessageFlags.Ephemeral });
		}
	}

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: "❌ can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const path = normalizeCommandPath(interaction.options.getString('command', true));

		try {
			if (!deleteCommandPermission(interaction.guildId, path)) {
				return interaction.reply({ content: `❌ \`${path}\` doesn't have a role requirement to remove.`, flags: MessageFlags.Ephemeral });
			}
			return interaction.reply({ content: `✅ role requirement removed from \`${path}\`.`, flags: MessageFlags.Ephemeral });
		} catch (error) {
			return interaction.reply({ content: `❌ failed to remove that permission: ${error}`, flags: MessageFlags.Ephemeral });
		}
	}

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: "❌ can't do that outside a server.", flags: MessageFlags.Ephemeral });
		try {
			const rows = getCommandPermissions(interaction.guildId);
			if (rows.length === 0) {
				return interaction.reply({
					content: "📋 nothing's set. every command's using its default permissions.",
					flags: MessageFlags.Ephemeral
				});
			}

			// Description lines rather than fields: an embed caps at 25 fields, and subcommand gates pass that quickly.
			const embed = new EmbedBuilder()
				.setTitle('Command Permissions')
				.setColor('#3986E4')
				.setDescription(
					[
						'Gates stack: `keyword` and `keyword add` both apply to `/keyword add`.',
						...rows.map((row) => `\`${row.command_name}\` → <@&${row.required_role_id}>`)
					].join('\n')
				)
				.setTimestamp();

			return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
		} catch (error) {
			return interaction.reply({ content: `❌ failed to list permissions: ${error}`, flags: MessageFlags.Ephemeral });
		}
	}

	public async chatInputCheck(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: "❌ can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const path = normalizeCommandPath(interaction.options.getString('command', true));

		try {
			const gates = getGatesForPath(interaction.guildId, path);
			if (gates.length === 0) {
				return interaction.reply({
					content: `📋 \`${path}\` has no role requirement, anyone can use it.`,
					flags: MessageFlags.Ephemeral
				});
			}

			const lines = gates.map((gate) => `\`${gate.command_name}\` → <@&${gate.required_role_id}>`);
			return interaction.reply({ content: `📋 \`${path}\` needs all of:\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
		} catch (error) {
			return interaction.reply({ content: `❌ failed to check that permission: ${error}`, flags: MessageFlags.Ephemeral });
		}
	}

	// Message command implementations for backwards compatibility
	public async messageSet(message: Message) {
		return message.reply('use the slash command for this one: `/permissions set`');
	}

	public async messageRemove(message: Message) {
		return message.reply('use the slash command for this one: `/permissions remove`');
	}

	public async messageList(message: Message) {
		return message.reply('use the slash command for this one: `/permissions list`');
	}

	public async messageCheck(message: Message) {
		return message.reply('use the slash command for this one: `/permissions check`');
	}
}
