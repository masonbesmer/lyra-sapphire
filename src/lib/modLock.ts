import {
	ChannelType,
	PermissionFlagsBits,
	PermissionsBitField,
	type Guild,
	type GuildBasedChannel,
	type PermissionOverwriteOptions
} from 'discord.js';
import { ModError } from './modActions';
import { getLockedChannels, isChannelLockedByBot, markChannelLocked, takeChannelLock, type OverwriteState } from './moderation';

/** What a lock denies @everyone. Threads too, or people just keep talking in a thread. */
export const LOCK_PERMISSIONS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'] as const;

/** Channels a server-wide lockdown covers. */
const LOCKABLE_TYPES = new Set<ChannelType>([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);

type LockableChannel = Extract<GuildBasedChannel, { permissionOverwrites: unknown }>;

function isLockable(channel: GuildBasedChannel | undefined | null): channel is LockableChannel {
	return !!channel && 'permissionOverwrites' in channel && !channel.isThread();
}

/** The @everyone overwrite's current state for the lock permissions. */
export function readOverwrite(allow: bigint, deny: bigint): OverwriteState {
	const allowed = new PermissionsBitField(allow);
	const denied = new PermissionsBitField(deny);
	const state: OverwriteState = {};
	for (const permission of LOCK_PERMISSIONS) {
		state[permission] = allowed.has(permission) ? true : denied.has(permission) ? false : null;
	}
	return state;
}

function everyoneOverwrite(channel: LockableChannel): OverwriteState {
	const overwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
	return readOverwrite(overwrite?.allow.bitfield ?? 0n, overwrite?.deny.bitfield ?? 0n);
}

/** Can @everyone talk here right now? Already-silent channels are left alone by a lockdown. */
function everyoneCanSend(channel: LockableChannel): boolean {
	return channel.permissionsFor(channel.guild.roles.everyone).has(PermissionFlagsBits.SendMessages);
}

function botCanEdit(channel: LockableChannel): boolean {
	const me = channel.guild.members.me;
	return !!me && channel.permissionsFor(me).has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]);
}

export function resolveLockable(guild: Guild, channelId: string): LockableChannel {
	const channel = guild.channels.cache.get(channelId);
	if (!isLockable(channel)) throw new ModError("that channel can't be locked.");
	return channel;
}

export async function lockChannel(channel: LockableChannel, reason: string): Promise<void> {
	if (isChannelLockedByBot(channel.guild.id, channel.id)) throw new ModError(`<#${channel.id}> is already locked.`);
	if (!everyoneCanSend(channel)) throw new ModError(`@everyone already can't send messages in <#${channel.id}>.`);
	const previous = everyoneOverwrite(channel);
	const deny: PermissionOverwriteOptions = Object.fromEntries(LOCK_PERMISSIONS.map((permission) => [permission, false]));
	await channel.permissionOverwrites.edit(channel.guild.roles.everyone, deny, { reason });
	markChannelLocked(channel.guild.id, channel.id, previous);
}

/**
 * Restores the overwrite Lyra replaced. A channel locked by hand (not through Lyra) just has
 * the deny lifted, which is the best guess at what "unlock" means there.
 */
export async function unlockChannel(channel: LockableChannel, reason: string): Promise<void> {
	const previous = takeChannelLock(channel.guild.id, channel.id);
	if (previous === null) {
		if (everyoneCanSend(channel)) throw new ModError(`<#${channel.id}> isn't locked.`);
		const lift: PermissionOverwriteOptions = Object.fromEntries(LOCK_PERMISSIONS.map((permission) => [permission, null]));
		await channel.permissionOverwrites.edit(channel.guild.roles.everyone, lift, { reason });
		return;
	}
	try {
		await channel.permissionOverwrites.edit(channel.guild.roles.everyone, previous as PermissionOverwriteOptions, { reason });
	} catch (error) {
		// Keep the record so a retry can still restore the original state.
		markChannelLocked(channel.guild.id, channel.id, previous);
		throw error;
	}
}

export interface BulkLockResult {
	changed: string[];
	failed: string[];
}

/** Locks every text-like channel @everyone can currently talk in. */
export async function lockServer(guild: Guild, reason: string): Promise<BulkLockResult> {
	const result: BulkLockResult = { changed: [], failed: [] };
	for (const channel of guild.channels.cache.values()) {
		if (!LOCKABLE_TYPES.has(channel.type) || !isLockable(channel)) continue;
		if (isChannelLockedByBot(guild.id, channel.id) || !everyoneCanSend(channel)) continue;
		if (!botCanEdit(channel)) {
			result.failed.push(channel.id);
			continue;
		}
		try {
			await lockChannel(channel, reason);
			result.changed.push(channel.id);
		} catch {
			result.failed.push(channel.id);
		}
	}
	return result;
}

/** Reopens every channel Lyra locked, and only those. */
export async function unlockServer(guild: Guild, reason: string): Promise<BulkLockResult> {
	const result: BulkLockResult = { changed: [], failed: [] };
	for (const channelId of getLockedChannels(guild.id)) {
		const channel = guild.channels.cache.get(channelId);
		if (!isLockable(channel)) {
			// Deleted since: nothing to restore.
			takeChannelLock(guild.id, channelId);
			continue;
		}
		try {
			await unlockChannel(channel, reason);
			result.changed.push(channel.id);
		} catch {
			result.failed.push(channel.id);
		}
	}
	return result;
}

export function summarize(result: BulkLockResult): string {
	const failed = result.failed.length ? `\ncouldn't change ${result.failed.length}: ${result.failed.map((id) => `<#${id}>`).join(', ')}` : '';
	return `${result.changed.length} channel(s)${failed}`;
}
