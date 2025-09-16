import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { EmbedBuilder, type Message } from 'discord.js';
import { db } from '../../lib/database';

@ApplyOptions<Subcommand.Options>({
	name: 'permissions',
	description: 'Manage command permissions (MAXTAC only)',
	preconditions: ['OwnerOnly'],
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
						.setDescription('Set role requirement for a command')
						.addStringOption((opt) => opt.setName('command').setDescription('Command name').setRequired(true))
						.addRoleOption((opt) => opt.setName('role').setDescription('Required role').setRequired(true))
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove role requirement from a command')
						.addStringOption((opt) => opt.setName('command').setDescription('Command name').setRequired(true))
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List all command permissions'))
				.addSubcommand((sub) =>
					sub
						.setName('check')
						.setDescription('Check role requirement for a command')
						.addStringOption((opt) => opt.setName('command').setDescription('Command name').setRequired(true))
				)
		);
	}

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		const commandName = interaction.options.getString('command', true).toLowerCase();
		const role = interaction.options.getRole('role', true);

		try {
			const stmt = db.prepare('INSERT OR REPLACE INTO command_permissions (command_name, required_role_id) VALUES (?, ?)');
			stmt.run(commandName, role.id);

			return interaction.reply({
				content: `✅ Set role requirement for command \`${commandName}\` to **${role.name}**`,
				ephemeral: true
			});
		} catch (error) {
			return interaction.reply({
				content: `❌ Failed to set permission: ${error}`,
				ephemeral: true
			});
		}
	}

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const commandName = interaction.options.getString('command', true).toLowerCase();

		try {
			const stmt = db.prepare('DELETE FROM command_permissions WHERE command_name = ?');
			const info = stmt.run(commandName);

			if (info.changes === 0) {
				return interaction.reply({
					content: `❌ No permission requirement found for command \`${commandName}\``,
					ephemeral: true
				});
			}

			return interaction.reply({
				content: `✅ Removed role requirement for command \`${commandName}\``,
				ephemeral: true
			});
		} catch (error) {
			return interaction.reply({
				content: `❌ Failed to remove permission: ${error}`,
				ephemeral: true
			});
		}
	}

	public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
		try {
			const rows = db.prepare('SELECT command_name, required_role_id FROM command_permissions ORDER BY command_name').all() as {
				command_name: string;
				required_role_id: string;
			}[];

			if (rows.length === 0) {
				return interaction.reply({
					content: '📋 No command permissions are currently set. All commands use default permissions.',
					ephemeral: true
				});
			}

			const embed = new EmbedBuilder()
				.setTitle('Command Permissions')
				.setColor('#3986E4')
				.setDescription('Commands with role requirements:')
				.setTimestamp();

			const fields = rows.map((row) => ({
				name: `\`${row.command_name}\``,
				value: `<@&${row.required_role_id}>`,
				inline: true
			}));

			embed.addFields(fields);

			return interaction.reply({ embeds: [embed], ephemeral: true });
		} catch (error) {
			return interaction.reply({
				content: `❌ Failed to list permissions: ${error}`,
				ephemeral: true
			});
		}
	}

	public async chatInputCheck(interaction: Subcommand.ChatInputCommandInteraction) {
		const commandName = interaction.options.getString('command', true).toLowerCase();

		try {
			const row = db.prepare('SELECT required_role_id FROM command_permissions WHERE command_name = ?').get(commandName) as
				| {
						required_role_id: string;
				  }
				| undefined;

			if (!row) {
				return interaction.reply({
					content: `📋 Command \`${commandName}\` has no role requirement (accessible to all users)`,
					ephemeral: true
				});
			}

			return interaction.reply({
				content: `📋 Command \`${commandName}\` requires role: <@&${row.required_role_id}>`,
				ephemeral: true
			});
		} catch (error) {
			return interaction.reply({
				content: `❌ Failed to check permission: ${error}`,
				ephemeral: true
			});
		}
	}

	// Message command implementations for backwards compatibility
	public async messageSet(message: Message) {
		return message.reply('❌ Please use the slash command version: `/permissions set`');
	}

	public async messageRemove(message: Message) {
		return message.reply('❌ Please use the slash command version: `/permissions remove`');
	}

	public async messageList(message: Message) {
		return message.reply('❌ Please use the slash command version: `/permissions list`');
	}

	public async messageCheck(message: Message) {
		return message.reply('❌ Please use the slash command version: `/permissions check`');
	}
}
