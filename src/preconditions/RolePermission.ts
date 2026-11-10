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
import type { APIInteractionGuildMember, ChatInputCommandInteraction, ContextMenuCommandInteraction, Message, Snowflake } from 'discord.js';
import { GuildMember } from 'discord.js';
import {
	PERMISSIONS_COMMAND,
	getGatesForPath,
	registeredSubcommandPaths,
	resolveMessageSubcommandPath,
	resolveRegisteredSubcommandPath
} from '../lib/commandPermissions';

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
		const path = [command.name, interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand(false)];
		return this.checkPermissions(path, interaction.member, interaction.guildId);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction, command: ContextMenuCommand) {
		return this.checkPermissions([command.name], interaction.member, interaction.guildId);
	}

	public override async messageRun(
		message: Message,
		command: MessageCommand,
		payload: Precondition.Context & Pick<PreMessageCommandRunPayload, 'parameters' | 'context'>
	) {
		const subcommandPath = await resolveMessageSubcommand(message, command, payload);
		return this.checkPermissions([command.name, ...subcommandPath], message.member, message.guildId);
	}

	private checkPermissions(path: (string | null)[], member: GuildMember | APIInteractionGuildMember | null, guildId: Snowflake | null) {
		if (!guildId || path[0] === PERMISSIONS_COMMAND) return this.ok();

		const gates = getGatesForPath(guildId, path.filter((part) => part !== null).join(' '));
		if (gates.length === 0) return this.ok();

		const roles = roleIdsOf(member);
		const holdsEveryGate = roles !== null && gates.every((gate) => roles.has(gate.required_role_id));
		return holdsEveryGate ? this.ok() : this.error({ message: this.#message });
	}
}

/** Uncached guilds hand interactions a raw API member, whose roles are plain IDs. */
function roleIdsOf(member: GuildMember | APIInteractionGuildMember | null): ReadonlySet<Snowflake> | ReadonlyMap<Snowflake, unknown> | null {
	if (member instanceof GuildMember) return member.roles.cache;
	return member ? new Set(member.roles) : null;
}

function isSubcommandCommand(command: MessageCommand): command is SubcommandMessageCommand {
	return Array.isArray((command as Partial<SubcommandMessageCommand>).parsedSubcommandMappings);
}

async function resolveMessageSubcommand(
	message: Message,
	command: MessageCommand,
	payload: Pick<PreMessageCommandRunPayload, 'parameters' | 'context'>
): Promise<string[]> {
	if (isSubcommandCommand(command)) {
		const [first, second] = await firstTwoTokens(message, command, payload);
		return resolveMessageSubcommandPath(command.parsedSubcommandMappings, first, second, command.caseInsensitiveSubcommands ?? false);
	}

	const registeredPaths = registeredSubcommandPaths(command.name, command.applicationCommandRegistry);
	if (registeredPaths.length === 0) return [];
	const [first, second] = await firstTwoTokens(message, command, payload);
	return resolveRegisteredSubcommandPath(registeredPaths, command.name, first, second);
}

/**
 * Tokenises with the command's own lexer, as the subcommand plugin does: a whitespace split
 * would read `"add"` or `--flag add` as no subcommand and skip the `add` gate.
 */
async function firstTwoTokens(
	message: Message,
	command: MessageCommand,
	payload: Pick<PreMessageCommandRunPayload, 'parameters' | 'context'>
): Promise<[string | null, string | null]> {
	const args = await command.messagePreParse(message, payload.parameters, payload.context);
	return [args.nextMaybe().unwrapOr(null), args.nextMaybe().unwrapOr(null)];
}

declare module '@sapphire/framework' {
	interface Preconditions {
		RolePermission: never;
	}
}
