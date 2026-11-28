import { Args, Command, CommandOptionsRunTypeEnum } from '@sapphire/framework';
import { InteractionContextType, type GuildMember, type Guild, type Message, type User } from 'discord.js';
import { ModError, fetchMember } from './modActions';
import { MAX_REASON_LENGTH, parseDuration } from './moderation';

/**
 * Shared plumbing for the moderation commands. Each command declares the Discord permission it
 * needs once, in `permission`: Sapphire's built-in preconditions enforce it for the moderator
 * (`requiredUserPermissions`) and the bot (`requiredClientPermissions`) on both slash and `%`
 * forms, and the slash command hides itself from members without it. The global RolePermission
 * precondition adds the `/permissions` role gates on top.
 */
export abstract class ModCommand extends Command {
	protected readonly permission: bigint;

	public constructor(context: Command.LoaderContext, options: ModCommandOptions) {
		super(context, {
			runIn: [CommandOptionsRunTypeEnum.GuildAny],
			requiredUserPermissions: options.permission,
			requiredClientPermissions: options.clientPermission ?? options.permission,
			...options
		});
		this.permission = options.permission;
	}

	/** Name, description, guild-only and the default permission every moderation slash command shares. */
	protected base<T extends SlashBase<T>>(builder: T): T {
		return builder
			.setName(this.name)
			.setDescription(this.description)
			.setDefaultMemberPermissions(this.permission)
			.setContexts(InteractionContextType.Guild);
	}
}

export interface ModCommandOptions extends Command.Options {
	/** What the moderator needs; also what the slash command is visible to by default. */
	permission: bigint;
	/** What the bot needs, when it differs from the moderator's. */
	clientPermission?: bigint;
}

interface SlashBase<T> {
	setName(name: string): T;
	setDescription(description: string): T;
	setDefaultMemberPermissions(permissions: bigint | string | number | null | undefined): T;
	setContexts(...contexts: InteractionContextType[]): T;
}

export interface ModContext {
	guild: Guild;
	moderator: GuildMember;
}

/** The guild and invoking member. `runIn: GuildAny` already keeps DMs out; this narrows the types. */
export function contextOf(source: Command.ChatInputCommandInteraction | Message): ModContext {
	if ('inCachedGuild' in source && typeof source.inCachedGuild === 'function') {
		if (!source.inCachedGuild()) throw new ModError("can't do that outside a server.");
		return { guild: source.guild, moderator: source.member };
	}
	const message = source as Message;
	if (!message.inGuild() || !message.member) throw new ModError("can't do that outside a server.");
	return { guild: message.guild, moderator: message.member };
}

export async function requireMember(guild: Guild, user: User): Promise<GuildMember> {
	const member = await fetchMember(guild, user.id);
	if (!member) throw new ModError(`${user.username} isn't in this server.`);
	return member;
}

export async function pickUser(args: Args): Promise<User | null> {
	return args.pick('user').catch(() => null);
}

/** Whatever is left of the message, as the reason. */
export async function restText(args: Args): Promise<string | null> {
	const text = await args.rest('string').catch(() => null);
	return text?.trim() ? text.trim().slice(0, MAX_REASON_LENGTH) : null;
}

/** Peeks at the next word and consumes it only if `parse` accepts it. */
export async function pickOptional<T>(args: Args, parse: (word: string) => T | null): Promise<T | null> {
	args.save();
	const word = await args.pick('string').catch(() => null);
	const value = word === null ? null : parse(word);
	if (value === null) args.restore();
	return value;
}

export function usage(text: string): never {
	throw new ModError(`usage: ${text}`);
}

/** Discord deletes at most 7 days of a banned user's messages. */
export const MAX_BAN_DELETE_SECONDS = 7 * 24 * 60 * 60;

export const DELETE_CHOICES = [
	{ name: "Don't delete any", value: 0 },
	{ name: 'Previous hour', value: 3600 },
	{ name: 'Previous 6 hours', value: 21_600 },
	{ name: 'Previous 12 hours', value: 43_200 },
	{ name: 'Previous 24 hours', value: 86_400 },
	{ name: 'Previous 3 days', value: 259_200 },
	{ name: 'Previous 7 days', value: 604_800 }
];

/** `--delete=1d` → seconds, capped at Discord's 7 days. */
export function parseDeleteOption(text: string | null): number {
	if (!text) return 0;
	const ms = parseDuration(text);
	if (ms === null) throw new ModError(`"${text}" isn't a duration I understand for --delete. try \`1h\` or \`1d\` (max 7d).`);
	return Math.min(Math.floor(ms / 1000), MAX_BAN_DELETE_SECONDS);
}
