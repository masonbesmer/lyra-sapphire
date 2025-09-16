import { AllFlowsPrecondition } from '@sapphire/framework';
import type { CommandInteraction, ContextMenuCommandInteraction, Message, Snowflake } from 'discord.js';
import { GuildMember } from 'discord.js';
import { db } from '../lib/database';

export class UserPrecondition extends AllFlowsPrecondition {
	#message = 'You do not have permission to use this command.';

	public override chatInputRun(interaction: CommandInteraction) {
		return this.checkPermissions(interaction.commandName, interaction.member, interaction.guildId);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
		return this.checkPermissions(interaction.commandName, interaction.member, interaction.guildId);
	}

	public override messageRun(message: Message, { command }: { command: { name: string } }) {
		return this.checkPermissions(command.name, message.member, message.guildId);
	}

	private checkPermissions(commandName: string, member: GuildMember | null, guildId: Snowflake | null) {
		// If not in a guild, allow the command (DM context)
		if (!guildId || !(member instanceof GuildMember)) {
			return this.ok();
		}

		// Check if there's a specific role requirement for this command
		const permissionRow = db.prepare('SELECT required_role_id FROM command_permissions WHERE command_name = ?').get(commandName) as
			| {
					required_role_id: string;
			  }
			| undefined;

		// If no specific permission is set, allow access (backwards compatibility)
		if (!permissionRow) {
			return this.ok();
		}

		// Check if the user has the required role
		const hasRequiredRole = member.roles.cache.has(permissionRow.required_role_id);
		return hasRequiredRole ? this.ok() : this.error({ message: this.#message });
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		RolePermission: never;
	}
}
