import { ApplyOptions } from '@sapphire/decorators';
import {
	AllFlowsPrecondition,
	Precondition,
	type ChatInputCommand,
	type ContextMenuCommand,
	type MessageCommand,
	type PreMessageCommandRunPayload
} from '@sapphire/framework';
import type { SubcommandMappingArray } from '@sapphire/plugin-subcommands';
import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message, Snowflake } from 'discord.js';
import { GuildMember } from 'discord.js';
import { PERMISSIONS_COMMAND, getGatesForPath, resolveMessageSubcommandPath } from '../lib/commandPermissions';

type SubcommandMessageCommand = MessageCommand & {
	parsedSubcommandMappings: SubcommandMappingArray;
	caseInsensitiveSubcommands?: boolean;
};

/**
 * Global, so every command and every subcommand is gated by `command_permissions` without
 * each command opting in. Runs after the framework's `Enabled` check (position 10).
 */
@ApplyOptions<Precondition.Options>({ position: 20 })
export class UserPrecondition extends AllFlowsPrecondition {
	#message = "you don't have permission for that one.";

	public override chatInputRun(interaction: ChatInputCommandInteraction, command: ChatInputCommand) {
		const member = interaction.member instanceof GuildMember ? interaction.member : null;
		const path = [command.name, interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand(false)];
		return this.checkPermissions(path, member, interaction.guildId);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction, command: ContextMenuCommand) {
		const member = interaction.member instanceof GuildMember ? interaction.member : null;
		return this.checkPermissions([command.name], member, interaction.guildId);
	}

	public override async messageRun(
		message: Message,
		command: MessageCommand,
		payload: Precondition.Context & Pick<PreMessageCommandRunPayload, 'parameters' | 'context'>
	) {
		const subcommandPath = isSubcommandCommand(command) ? await resolveMessageSubcommand(message, command, payload) : [];
		return this.checkPermissions([command.name, ...subcommandPath], message.member, message.guildId);
	}

	private checkPermissions(path: (string | null)[], member: GuildMember | null, guildId: Snowflake | null) {
		if (!guildId || !(member instanceof GuildMember)) return this.ok();
		if (path[0] === PERMISSIONS_COMMAND) return this.ok();

		const gates = getGatesForPath(guildId, path.filter((part) => part !== null).join(' '));
		const holdsEveryGate = gates.every((gate) => member.roles.cache.has(gate.required_role_id));
		return holdsEveryGate ? this.ok() : this.error({ message: this.#message });
	}
}

function isSubcommandCommand(command: MessageCommand): command is SubcommandMessageCommand {
	return Array.isArray((command as Partial<SubcommandMessageCommand>).parsedSubcommandMappings);
}

/**
 * Tokenises with the command's own lexer, as the subcommand plugin does: a whitespace split
 * would read `"add"` or `--flag add` as no subcommand and skip the `add` gate.
 */
async function resolveMessageSubcommand(
	message: Message,
	command: SubcommandMessageCommand,
	payload: Pick<PreMessageCommandRunPayload, 'parameters' | 'context'>
): Promise<string[]> {
	const args = await command.messagePreParse(message, payload.parameters, payload.context);
	const first = args.nextMaybe().unwrapOr(null);
	const second = args.nextMaybe().unwrapOr(null);
	return resolveMessageSubcommandPath(command.parsedSubcommandMappings, first, second, command.caseInsensitiveSubcommands ?? false);
}

declare module '@sapphire/framework' {
	interface Preconditions {
		RolePermission: never;
	}
}
