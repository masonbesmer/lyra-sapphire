import type { Guild, GuildMember, User, VoiceBasedChannel } from 'discord.js';
import { ModError, actWithCase, assertCanModerate, auditReason, caseSuffix } from './modActions';
import { requireMember, type ModContext } from './modCommand';
import type { ModAction, ModCase } from './moderation';

/**
 * Voice moderation (LYRA-12): server mute, server deafen, disconnect and move. They act on the
 * member's voice state, so the target has to be in a voice channel right now. Mute and deafen
 * are toggles: running /vmute on someone already server-muted unmutes them.
 */

export type VoiceAction = 'mute' | 'deafen' | 'kick' | 'move';

/** The member, provided they're in a voice channel and the moderator outranks them. */
export async function voiceTarget({ guild, moderator }: ModContext, user: User): Promise<{ member: GuildMember; channel: VoiceBasedChannel }> {
	const member = await requireMember(guild, user);
	await assertCanModerate(moderator, member);
	const channel = member.voice.channel;
	if (!channel) throw new ModError(`${user.username} isn't in a voice channel.`);
	return { member, channel };
}

/** Which case a toggle records: turning mute on is `vmute`, turning it off is `vunmute`. */
export function toggleAction(kind: 'mute' | 'deafen', currentlyOn: boolean): ModAction {
	if (kind === 'mute') return currentlyOn ? 'vunmute' : 'vmute';
	return currentlyOn ? 'vundeafen' : 'vdeafen';
}

async function record(
	guild: Guild,
	moderator: GuildMember,
	user: User,
	action: ModAction,
	reason: string | null,
	act: () => Promise<unknown>,
	extra: { name: string; value: string }[] = []
): Promise<ModCase> {
	const { modCase } = await actWithCase(
		guild,
		{ action, targetId: user.id, targetTag: user.username, moderatorId: moderator.id, moderatorTag: moderator.user.username, reason },
		act,
		{ extra }
	);
	return modCase;
}

export async function voiceMute(context: ModContext, user: User, reason: string | null): Promise<string> {
	const { member, channel } = await voiceTarget(context, user);
	const on = member.voice.serverMute === true;
	const action = toggleAction('mute', on);
	const modCase = await record(context.guild, context.moderator, user, action, reason, () =>
		member.voice.setMute(!on, auditReason(context.moderator.user, reason))
	);
	const verb = on ? '🔊 unmuted' : '🔇 server-muted';
	return `${verb} <@${user.id}> in <#${channel.id}>${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase)}`;
}

export async function voiceDeafen(context: ModContext, user: User, reason: string | null): Promise<string> {
	const { member, channel } = await voiceTarget(context, user);
	const on = member.voice.serverDeaf === true;
	const action = toggleAction('deafen', on);
	const modCase = await record(context.guild, context.moderator, user, action, reason, () =>
		member.voice.setDeaf(!on, auditReason(context.moderator.user, reason))
	);
	const verb = on ? '🔈 undeafened' : '🔕 server-deafened';
	return `${verb} <@${user.id}> in <#${channel.id}>${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase)}`;
}

export async function voiceKick(context: ModContext, user: User, reason: string | null): Promise<string> {
	const { member, channel } = await voiceTarget(context, user);
	const modCase = await record(
		context.guild,
		context.moderator,
		user,
		'vkick',
		reason,
		() => member.voice.disconnect(auditReason(context.moderator.user, reason)),
		[{ name: 'Channel', value: `<#${channel.id}>` }]
	);
	return `📤 disconnected <@${user.id}> from <#${channel.id}>${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase)}`;
}

export async function voiceMove(context: ModContext, user: User, destination: VoiceBasedChannel, reason: string | null): Promise<string> {
	const { member, channel } = await voiceTarget(context, user);
	if (channel.id === destination.id) throw new ModError(`they're already in <#${destination.id}>.`);
	// Discord checks Connect for the bot on the destination; the moderator should be able to see it too.
	if (!destination.permissionsFor(context.moderator).has('Connect')) throw new ModError(`you can't join <#${destination.id}> yourself.`);
	const modCase = await record(
		context.guild,
		context.moderator,
		user,
		'vmove',
		reason,
		() => member.voice.setChannel(destination, auditReason(context.moderator.user, reason)),
		[{ name: 'Moved', value: `<#${channel.id}> → <#${destination.id}>` }]
	);
	return `➡️ moved <@${user.id}> from <#${channel.id}> to <#${destination.id}>${modCase.reason ? `: ${modCase.reason}` : ''}\n${caseSuffix(modCase)}`;
}
