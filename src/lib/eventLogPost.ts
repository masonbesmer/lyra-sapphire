import { container } from '@sapphire/framework';
import { PermissionFlagsBits, type AttachmentBuilder, type EmbedBuilder, type Guild, type Invite } from 'discord.js';
import { findUsedInvite, getLogChannel, type InviteSnapshot, type LogEvent } from './eventLog';

/**
 * The Discord side of event logging: posting to the routed channel and keeping the invite-use
 * snapshot that tells which invite a new member came in on.
 */

/** Posts an event to its log channel, if the guild routes that event. Failures are logged, never thrown. */
export async function postEventLog(guild: Guild, event: LogEvent, embed: EmbedBuilder, files: AttachmentBuilder[] = []): Promise<void> {
	const channelId = getLogChannel(guild.id, event);
	if (!channelId) return;
	try {
		const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId));
		if (!channel?.isSendable()) return;
		await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
	} catch (error) {
		container.logger.warn(`[event-log] couldn't post ${event} to ${channelId} in ${guild.id}: ${String(error)}`);
	}
}

// ---------------------------------------------------------------------------------------------
// Invite tracking
// ---------------------------------------------------------------------------------------------

/** guild id → invite code → snapshot. Only kept for guilds that log joins. */
const inviteCache = new Map<string, Map<string, InviteSnapshot>>();

function snapshot(invite: Invite): InviteSnapshot {
	return { code: invite.code, uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0, inviterId: invite.inviterId ?? null };
}

async function fetchInvites(guild: Guild): Promise<InviteSnapshot[] | null> {
	if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
	try {
		const invites = await guild.invites.fetch({ cache: false });
		return [...invites.values()].map(snapshot);
	} catch (error) {
		container.logger.debug(`[event-log] couldn't fetch invites for ${guild.id}: ${String(error)}`);
		return null;
	}
}

function store(guildId: string, invites: InviteSnapshot[]): void {
	inviteCache.set(guildId, new Map(invites.map((invite) => [invite.code, invite])));
}

/** Takes the first snapshot for a guild that logs joins. Without it the first join can't be attributed. */
export async function primeInvites(guild: Guild): Promise<void> {
	if (!getLogChannel(guild.id, 'member_join')) {
		inviteCache.delete(guild.id);
		return;
	}
	const invites = await fetchInvites(guild);
	if (invites) store(guild.id, invites);
}

export function rememberInvite(invite: Invite): void {
	if (!invite.guild) return;
	inviteCache.get(invite.guild.id)?.set(invite.code, snapshot(invite));
}

export function forgetInvite(guildId: string, code: string): void {
	inviteCache.get(guildId)?.delete(code);
}

export type InviteResult = { kind: 'invite'; invite: InviteSnapshot } | { kind: 'vanity'; code: string } | { kind: 'unknown' };

/** Works out which invite a member who just joined used, and refreshes the snapshot. */
export async function resolveJoinInvite(guild: Guild): Promise<InviteResult> {
	const before = inviteCache.get(guild.id);
	const after = await fetchInvites(guild);
	if (!after) return { kind: 'unknown' };
	store(guild.id, after);
	if (!before) return { kind: 'unknown' };
	const used = findUsedInvite(before, after);
	if (used) return { kind: 'invite', invite: used };
	if (guild.vanityURLCode) return { kind: 'vanity', code: guild.vanityURLCode };
	return { kind: 'unknown' };
}
