import type { Precondition, PreconditionResult, Result, UserError } from '@sapphire/framework';
import { GuildMember } from 'discord.js';

/**
 * A `GuildMember` that passes `instanceof` checks, carrying only the fields a test hands it.
 * `roles`, `voice` and `permissions` are prototype getters on the real class, so they are
 * defined as own properties rather than assigned.
 */
export function guildMember(fields: Record<string, unknown>): GuildMember {
	const member = Object.create(GuildMember.prototype) as GuildMember;
	for (const [key, value] of Object.entries(fields)) Object.defineProperty(member, key, { value });
	return member;
}

/**
 * Preconditions keep their messages in `#private` fields that only the constructor
 * initialises, so they have to be built for real rather than from the prototype.
 */
export function buildPrecondition<T extends Precondition>(Ctor: new (context: never, options: never) => T, name: string): T {
	return new Ctor({ name, path: '', root: '', store: null } as never, {} as never);
}

/** Every precondition in this bot answers synchronously; this unwraps the `Awaitable` in its signature. */
export function settled(result: PreconditionResult): Result<unknown, UserError> {
	if ('then' in result) throw new Error('expected a synchronous precondition result');
	return result;
}
