import { container } from '@sapphire/framework';
import type { SubcommandMappingArray } from '@sapphire/plugin-subcommands';
import type { CommandPermission } from './config';
import { db } from './database';

/**
 * Role gates live in `command_permissions.command_name` as a space-separated command path:
 * `keyword` gates the whole command, `keyword add` one subcommand, `starboard blacklist add`
 * one entry of a subcommand group. A member must hold every gate on the path they invoke.
 */

/** /permissions stays Administrator-only through its own `requiredUserPermissions`; it is never gated by a role. */
export const PERMISSIONS_COMMAND = 'permissions';

/** The command store pieces this module reads; `parsedSubcommandMappings` is only present on subcommand commands. */
export interface PermissionTargetSource {
	name: string;
	parsedSubcommandMappings?: SubcommandMappingArray;
}

/** `/Keyword   ADD` and `keyword add` name the same gate. */
export function normalizeCommandPath(input: string): string {
	return input.trim().replace(/^\//, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** `'a b c'` → `['a', 'a b', 'a b c']`: every gate that applies to an invocation of `path`. */
export function pathPrefixes(path: string): string[] {
	const parts = path.split(' ');
	return parts.map((_, index) => parts.slice(0, index + 1).join(' '));
}

export function isUnderPermissionsCommand(path: string): boolean {
	return path === PERMISSIONS_COMMAND || path.startsWith(`${PERMISSIONS_COMMAND} `);
}

/**
 * Which subcommand a message command invocation runs, from its first two argument tokens.
 * Returns `[]` when nothing matches (the plugin then runs nothing), `[sub]`, or `[group, entry]`.
 *
 * Must track `Subcommand#messageRun` in @sapphire/plugin-subcommands ^7.0.1, including its
 * quirks: group names are compared without case folding, a matched group with no matching
 * entry falls back to its last `default` entry (or clears an earlier top-level default), and
 * only the first top-level `default` method counts.
 */
export function resolveMessageSubcommandPath(
	mappings: SubcommandMappingArray,
	first: string | null,
	second: string | null,
	caseInsensitive: boolean
): string[] {
	const fold = (token: string) => (caseInsensitive ? token.toLowerCase() : token);
	let fallback: string[] | null = null;

	for (const mapping of mappings) {
		if (mapping.type === 'group') {
			if (first === null || second === null || mapping.name !== first) continue;
			const expected = fold(second);
			let groupDefault: string | null = null;
			for (const entry of mapping.entries) {
				if (entry.name === expected) return [mapping.name, entry.name];
				if (entry.default) groupDefault = entry.name;
			}
			fallback = groupDefault === null ? null : [mapping.name, groupDefault];
			continue;
		}

		if (mapping.default && fallback === null) fallback = [mapping.name];
		if (first !== null && mapping.name === fold(first)) return [mapping.name];
	}

	return fallback ?? [];
}

/** Every path a gate can be set on: each command, plus its subcommands, groups and group entries. `permissions` is excluded. */
export function listPermissionTargets(commands: Iterable<PermissionTargetSource>): string[] {
	const targets = new Set<string>();
	for (const command of commands) {
		if (command.name === PERMISSIONS_COMMAND) continue;
		targets.add(command.name);
		for (const mapping of command.parsedSubcommandMappings ?? []) {
			const path = `${command.name} ${mapping.name}`;
			targets.add(path);
			if (mapping.type === 'group') {
				for (const entry of mapping.entries) targets.add(`${path} ${entry.name}`);
			}
		}
	}
	return [...targets].sort();
}

export function isPermissionTarget(path: string, commands: Iterable<PermissionTargetSource> = container.stores.get('commands').values()): boolean {
	return listPermissionTargets(commands).includes(path);
}

/** The guild's gates on `path` and every ancestor of it, outermost first. */
export function getGatesForPath(guildId: string, path: string): CommandPermission[] {
	const prefixes = pathPrefixes(path);
	return db
		.prepare(
			`SELECT command_name, required_role_id FROM command_permissions
			WHERE guild_id = ? AND command_name IN (${prefixes.map(() => '?').join(', ')})
			ORDER BY command_name`
		)
		.all(guildId, ...prefixes) as CommandPermission[];
}
