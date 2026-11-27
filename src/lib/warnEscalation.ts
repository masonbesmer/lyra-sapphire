import { container } from '@sapphire/framework';
import type { Guild, GuildMember } from 'discord.js';
import { actWithCase } from './modActions';
import { cancelScheduledAction, formatDuration, scheduleAction, type ModCase } from './moderation';
import { countActiveWarns, getThresholds, thresholdFor, type ThresholdAction } from './warnThresholds';

/**
 * Actions Lyra takes on her own (AutoMod, warn thresholds). Same shape as a moderator's action:
 * a case with Lyra as the moderator, the DM first, then the action, then the mod log.
 */

export type BotAction = 'warn' | ThresholdAction;

export interface BotActionResult {
	modCase: ModCase;
	dm: boolean | undefined;
}

/** Discord's own view of whether the bot outranks the member enough for this action. */
export function botCanApply(member: GuildMember, action: BotAction): boolean {
	if (member.id === member.guild.ownerId) return false;
	if (action === 'warn') return true;
	if (action === 'timeout') return member.moderatable;
	if (action === 'kick') return member.kickable;
	return member.bannable;
}

/**
 * Applies `action` to `member` as Lyra and records the case. Returns null if Discord wouldn't let
 * the bot do it (owner, admin, higher role): there is no moderator to tell, so it just doesn't happen.
 */
export async function applyBotAction(
	guild: Guild,
	member: GuildMember,
	action: BotAction,
	reason: string,
	durationMs: number | null,
	extra: { name: string; value: string }[] = []
): Promise<BotActionResult | null> {
	if (!botCanApply(member, action)) return null;
	const me = guild.members.me ?? (await guild.members.fetchMe());
	const auditReason = `AutoMod: ${reason}`.slice(0, 512);
	const input = {
		action,
		targetId: member.id,
		targetTag: member.user.username,
		moderatorId: me.id,
		moderatorTag: me.user.username,
		reason,
		durationMs: action === 'kick' || action === 'warn' ? null : durationMs
	};
	const act = (): Promise<unknown> => {
		if (action === 'warn') return Promise.resolve();
		if (action === 'timeout') return member.timeout(durationMs ?? 0, auditReason);
		if (action === 'kick') return member.kick(auditReason);
		return guild.bans.create(member.id, { reason: auditReason });
	};
	const result = await actWithCase(guild, input, act, { notify: member.user, extra });
	if (action === 'ban') {
		if (durationMs && result.modCase.expires_at) {
			scheduleAction(guild.id, 'unban', member.id, new Date(result.modCase.expires_at), result.modCase.case_number);
		} else {
			cancelScheduledAction(guild.id, 'unban', member.id);
		}
	}
	return result;
}

/**
 * Called after every warn (a moderator's /warn or an AutoMod warn). If the member now has exactly
 * as many active warnings as a threshold, applies it. Returns a line for the moderator's reply,
 * or null when nothing happened. Never throws: the warn itself already succeeded.
 */
export async function escalateWarnings(guild: Guild, member: GuildMember, now = new Date()): Promise<string | null> {
	try {
		const thresholds = getThresholds(guild.id);
		if (!thresholds.length) return null;
		const active = countActiveWarns(guild.id, member.id, now);
		const threshold = thresholdFor(thresholds, active);
		if (!threshold) return null;
		const reason = `Reached ${active} active warnings`;
		const result = await applyBotAction(guild, member, threshold.action, reason, threshold.duration_ms);
		if (!result) return `-# ${active} active warnings, but I can't ${threshold.action} them (their role is too high).`;
		const length = threshold.duration_ms && threshold.action !== 'kick' ? ` for ${formatDuration(threshold.duration_ms)}` : '';
		const verb = threshold.action === 'timeout' ? 'timed out' : threshold.action === 'kick' ? 'kicked' : 'banned';
		return `-# ${active} active warnings → ${verb}${length} (case #${result.modCase.case_number})`;
	} catch (error) {
		container.logger.warn(`[moderation] warn threshold for ${member.id} in ${guild.id} failed: ${String(error)}`);
		return null;
	}
}
