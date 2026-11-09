import type { SubcommandMappingArray } from '@sapphire/plugin-subcommands';
import { describe, expect, it } from 'vitest';
import {
	getGatesForPath,
	isPermissionTarget,
	isUnderPermissionsCommand,
	listPermissionTargets,
	normalizeCommandPath,
	pathPrefixes,
	resolveMessageSubcommandPath
} from '../../src/lib/commandPermissions';
import { setCommandPermission } from '../../src/lib/config';

const keyword: SubcommandMappingArray = [
	{ name: 'add', messageRun: 'a' },
	{ name: 'delete', messageRun: 'd' },
	{ name: 'edit', messageRun: 'e' }
];
const starboard: SubcommandMappingArray = [
	{ name: 'config', messageRun: 'c', default: true },
	{
		name: 'blacklist',
		type: 'group',
		entries: [
			{ name: 'add', messageRun: 'ba' },
			{ name: 'list', messageRun: 'bl', default: true }
		]
	}
];
const commands = [
	{ name: 'ping' },
	{ name: 'keyword', parsedSubcommandMappings: keyword },
	{ name: 'starboard', parsedSubcommandMappings: starboard },
	{ name: 'permissions', parsedSubcommandMappings: [{ name: 'set', messageRun: 's' }] }
];

describe('normalizeCommandPath', () => {
	it('folds case, a leading slash and runs of whitespace', () => {
		expect(normalizeCommandPath('  /Keyword   ADD ')).toBe('keyword add');
	});
});

describe('pathPrefixes', () => {
	it('lists the path and every ancestor, outermost first', () => {
		expect(pathPrefixes('starboard blacklist add')).toEqual(['starboard', 'starboard blacklist', 'starboard blacklist add']);
	});
});

describe('isUnderPermissionsCommand', () => {
	it('matches permissions and its subcommands only', () => {
		expect(isUnderPermissionsCommand('permissions')).toBe(true);
		expect(isUnderPermissionsCommand('permissions set')).toBe(true);
		expect(isUnderPermissionsCommand('permissionsx')).toBe(false);
	});
});

describe('listPermissionTargets', () => {
	it('lists commands, subcommands, groups and group entries, without permissions', () => {
		expect(listPermissionTargets(commands)).toEqual([
			'keyword',
			'keyword add',
			'keyword delete',
			'keyword edit',
			'ping',
			'starboard',
			'starboard blacklist',
			'starboard blacklist add',
			'starboard blacklist list',
			'starboard config'
		]);
	});

	it('backs isPermissionTarget', () => {
		expect(isPermissionTarget('keyword add', commands)).toBe(true);
		expect(isPermissionTarget('keyword nope', commands)).toBe(false);
		expect(isPermissionTarget('permissions set', commands)).toBe(false);
	});
});

describe('resolveMessageSubcommandPath', () => {
	it('matches a subcommand by its first token', () => {
		expect(resolveMessageSubcommandPath(keyword, 'add', 'hi', false)).toEqual(['add']);
	});

	it('folds the subcommand token only when case-insensitive', () => {
		expect(resolveMessageSubcommandPath(keyword, 'ADD', null, true)).toEqual(['add']);
		expect(resolveMessageSubcommandPath(keyword, 'ADD', null, false)).toEqual([]);
	});

	it('matches a group entry', () => {
		expect(resolveMessageSubcommandPath(starboard, 'blacklist', 'ADD', true)).toEqual(['blacklist', 'add']);
	});

	it("falls back to a matched group's default entry", () => {
		expect(resolveMessageSubcommandPath(starboard, 'blacklist', 'nope', true)).toEqual(['blacklist', 'list']);
	});

	it('falls back to the top-level default when nothing matches', () => {
		expect(resolveMessageSubcommandPath(starboard, 'nope', null, true)).toEqual(['config']);
		expect(resolveMessageSubcommandPath(starboard, null, null, true)).toEqual(['config']);
	});

	it('resolves nothing when nothing matches and there is no default', () => {
		expect(resolveMessageSubcommandPath(keyword, 'nope', null, true)).toEqual([]);
	});
});

describe('getGatesForPath', () => {
	const GUILD = 'gates-guild';
	setCommandPermission(GUILD, 'keyword', 'a');
	setCommandPermission(GUILD, 'keyword add', 'b');
	setCommandPermission(GUILD, 'keyword edit', 'c');
	setCommandPermission('gates-other', 'keyword add', 'd');

	it("returns this guild's gates on the path and its ancestors only", () => {
		expect(getGatesForPath(GUILD, 'keyword add')).toEqual([
			{ command_name: 'keyword', required_role_id: 'a' },
			{ command_name: 'keyword add', required_role_id: 'b' }
		]);
		expect(getGatesForPath(GUILD, 'ping')).toEqual([]);
	});
});
