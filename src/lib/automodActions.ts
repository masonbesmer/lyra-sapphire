import { container } from '@sapphire/framework';
import {
	AutoModerationActionType,
	Colors,
	EmbedBuilder,
	PermissionFlagsBits,
	type AutoModerationActionExecution,
	type Guild,
	type GuildMember,
	type Message
} from 'discord.js';
import {
	CONTENT_RULES,
	DEFAULT_TIMEOUT_MS,
	RULE_DESCRIPTIONS,
	SpamTracker,
	checkContentRule,
	duplicateKey,
	getAutomodSettings,
	getEnabledRules,
	isExempt,
	pickWorst,
	type AutomodMessage,
	type RuleConfig,
	type TrackedMessage,
	type Violation
} from './automod';
import { effectiveSource, nativeKindOf } from './automodNative';
import { fetchMember } from './modActions';
import { getModConfig } from './moderation';
import { applyBotAction, escalateWarnings } from './warnEscalation';

/**
 * Applies AutoMod to real messages: the bot-side filters on messageCreate / messageUpdate, and
 * the filter's action when one of Lyra's native AutoMod rules blocks something.
 */

const tracker = new SpamTracker();
/** guild:user → time until which a member isn't punished again (their burst still gets deleted). */
const punishCooldown = new Map<string, number>();
/** guild:user → time until which no "message removed" notice is posted again. */
const noticeCooldown = new Map<string, number>();
const PUNISH_COOLDOWN_MS = 15_000;
const NOTICE_COOLDOWN_MS = 10_000;
const NOTICE_LIFETIME_MS = 6_000;
let lastSweep = 0;

export interface Hit {
	config: RuleConfig;
	violation: Violation;
	/** For rate filters: the burst, so all of it can be removed. */
	burst?: TrackedMessage[];
}

function sweep(now: number): void {
	if (now - lastSweep < 5 * 60_000) return;
	lastSweep = now;
	tracker.sweep(now);
	for (const map of [punishCooldown, noticeCooldown]) {
		for (const [key, until] of map) if (until < now) map.delete(key);
	}
}

/** Owners and administrators are never filtered; nor are bots, webhooks and system messages. */
export function isImmune(member: GuildMember): boolean {
	return member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
}

export function toAutomodMessage(message: Message): AutomodMessage {
	return {
		content: message.content ?? '',
		mentionCount: message.mentions.parsedUsers.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0),
		attachmentNames: [...message.attachments.values()].map((attachment) => attachment.name ?? '')
	};
}

/** Runs every enabled filter that applies; returns the hits (empty if the message is fine). */
export function evaluate(rules: readonly RuleConfig[], message: Message<true>, member: GuildMember, edited: boolean, now = Date.now()): Hit[] {
	const settings = getAutomodSettings(message.guildId);
	const who = {
		roleIds: [...member.roles.cache.keys()],
		channelId: message.channelId,
		parentChannelId: message.channel.isThread() ? message.channel.parentId : null
	};
	if (isExempt(settings, who)) return [];

	const data = toAutomodMessage(message);
	const hits: Hit[] = [];
	let history: TrackedMessage[] | null = null;
	for (const config of rules) {
		if (isExempt(config, who)) continue;
		if (config.rule === 'duplicates' || config.rule === 'flood') {
			if (edited) continue;
			history ??= tracker.record(message.guildId, member.id, {
				id: message.id,
				channelId: message.channelId,
				at: now,
				key: duplicateKey(data.content)
			});
			const burst = tracker.check(config.rule, config.settings, history, now);
			if (burst) {
				const detail = config.rule === 'flood' ? `${burst.length} messages too fast` : `the same message ${burst.length} times`;
				hits.push({ config, violation: { rule: config.rule, detail }, burst });
			}
			continue;
		}
		if (edited && !CONTENT_RULES.includes(config.rule)) continue;
		const violation = checkContentRule(config, data);
		if (violation) hits.push({ config, violation });
	}
	return hits;
}

/** Entry point for messageCreate / messageUpdate. Never throws. */
export async function runAutomod(message: Message, edited = false): Promise<void> {
	try {
		if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
		const rules = getEnabledRules(message.guildId);
		if (!rules.length) return;
		const member = message.member ?? (await fetchMember(message.guild, message.author.id));
		if (!member || isImmune(member)) return;

		const now = Date.now();
		sweep(now);
		const worst = pickWorst(evaluate(rules, message, member, edited, now));
		if (!worst) return;
		await enforce(message, member, worst, now);
	} catch (error) {
		container.logger.warn(
			`[automod] failed on message ${message.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
		);
	}
}

function excerpt(text: string, max = 900): string {
	const clean = text.replace(/`/g, 'ˋ');
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function ruleReason(violation: Violation): string {
	return `${violation.rule}: ${violation.detail}`;
}

async function removeMessages(message: Message<true>, hit: Hit): Promise<boolean> {
	const ids = new Set([message.id, ...(hit.burst ?? []).filter((entry) => entry.channelId === message.channelId).map((entry) => entry.id)]);
	try {
		if (ids.size > 1 && 'bulkDelete' in message.channel) {
			await message.channel.bulkDelete([...ids], true);
		} else {
			await message.delete();
		}
		return true;
	} catch (error) {
		container.logger.debug(`[automod] couldn't delete ${message.id}: ${String(error)}`);
		return false;
	}
}

async function postNotice(message: Message<true>, text: string, now: number): Promise<void> {
	const key = `${message.guildId}:${message.author.id}`;
	if ((noticeCooldown.get(key) ?? 0) > now) return;
	noticeCooldown.set(key, now + NOTICE_COOLDOWN_MS);
	try {
		if (!message.channel.isSendable()) return;
		const notice = await message.channel.send({ content: `<@${message.author.id}> ${text}`, allowedMentions: { users: [message.author.id] } });
		setTimeout(() => void notice.delete().catch(() => undefined), NOTICE_LIFETIME_MS).unref();
	} catch {
		// No permission to post here: the deletion itself already happened.
	}
}

/** Posts a no-case AutoMod entry (delete / log only) to the mod-log channel. Best-effort. */
export async function postAutomodLog(guild: Guild, embed: EmbedBuilder): Promise<void> {
	const { log_channel_id } = getModConfig(guild.id);
	if (!log_channel_id) return;
	try {
		const channel = guild.channels.cache.get(log_channel_id) ?? (await guild.channels.fetch(log_channel_id));
		if (channel?.isSendable()) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
	} catch (error) {
		container.logger.debug(`[automod] couldn't post to the mod log in ${guild.id}: ${String(error)}`);
	}
}

export function automodEmbed(opts: {
	title: string;
	color: number;
	userId: string;
	channelId: string;
	violation: Violation;
	content: string;
	note?: string;
}): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(opts.color)
		.setTitle(opts.title)
		.addFields(
			{ name: 'User', value: `<@${opts.userId}>`, inline: true },
			{ name: 'Channel', value: `<#${opts.channelId}>`, inline: true },
			{ name: 'Filter', value: `${opts.violation.rule} — ${RULE_DESCRIPTIONS[opts.violation.rule]}` },
			{ name: 'Why', value: opts.violation.detail }
		)
		.setFooter({ text: `User ID: ${opts.userId}` })
		.setTimestamp(new Date());
	if (opts.content) embed.addFields({ name: 'Message', value: `\`\`\`\n${excerpt(opts.content)}\n\`\`\`` });
	if (opts.note) embed.addFields({ name: 'Note', value: opts.note });
	return embed;
}

/**
 * Applies a filter's action as Lyra. Shared by the bot-side filters and native-rule executions.
 * Returns a short description of what happened.
 */
export async function punish(
	guild: Guild,
	member: GuildMember,
	config: RuleConfig,
	violation: Violation,
	context: { channelId: string; content: string },
	now = Date.now()
): Promise<string> {
	const action = config.action;
	const embedBase = { userId: member.id, channelId: context.channelId, violation, content: context.content };
	if (action === 'log' || action === 'delete') {
		await postAutomodLog(
			guild,
			automodEmbed({
				...embedBase,
				title: action === 'log' ? 'AutoMod: flagged (log only)' : 'AutoMod: message removed',
				color: Colors.Greyple
			})
		);
		return action === 'log' ? 'logged' : 'removed';
	}

	const key = `${guild.id}:${member.id}`;
	if ((punishCooldown.get(key) ?? 0) > now) return 'removed (already actioned moments ago)';
	punishCooldown.set(key, now + PUNISH_COOLDOWN_MS);
	tracker.reset(guild.id, member.id);

	const duration = action === 'timeout' ? (config.durationMs ?? DEFAULT_TIMEOUT_MS) : config.durationMs;
	const extra = [
		{ name: 'Channel', value: `<#${context.channelId}>`, inline: true },
		...(context.content ? [{ name: 'Message', value: `\`\`\`\n${excerpt(context.content, 900)}\n\`\`\`` }] : [])
	];
	const result = await applyBotAction(guild, member, action, `AutoMod ${ruleReason(violation)}`, duration, extra);
	if (!result) {
		await postAutomodLog(
			guild,
			automodEmbed({
				...embedBase,
				title: 'AutoMod: message removed',
				color: Colors.Greyple,
				note: `Couldn't ${action} them: their top role is at or above mine.`
			})
		);
		return 'removed';
	}
	let summary = `${action} (case #${result.modCase.case_number})`;
	if (action === 'warn') {
		const escalation = await escalateWarnings(guild, member);
		if (escalation) summary += ` ${escalation.replace(/^-# /, '')}`;
	}
	return summary;
}

async function enforce(message: Message<true>, member: GuildMember, hit: Hit, now: number): Promise<void> {
	const { config, violation } = hit;
	if (config.action !== 'log') {
		const removed = await removeMessages(message, hit);
		if (removed && config.action === 'delete') await postNotice(message, `your message was removed by AutoMod (${violation.rule}).`, now);
	}
	await punish(message.guild, member, config, violation, { channelId: message.channelId, content: message.content }, now);
}

/**
 * One of Lyra's native rules blocked a message. Discord sends one event per native action, so only
 * the block event is acted on (or the alert, for a log-only rule that doesn't block).
 */
export async function handleNativeExecution(execution: AutoModerationActionExecution): Promise<void> {
	try {
		const { guild } = execution;
		const rule = execution.autoModerationRule ?? (await guild.autoModerationRules.fetch(execution.ruleId).catch(() => null));
		if (!rule || rule.creatorId !== guild.client.user?.id) return;
		const kind = nativeKindOf(rule.name);
		if (!kind) return;
		const blocks = rule.actions.some((action) => action.type === AutoModerationActionType.BlockMessage);
		const wanted = blocks ? AutoModerationActionType.BlockMessage : AutoModerationActionType.SendAlertMessage;
		if (execution.action.type !== wanted) return;

		const config = effectiveSource(guild.id, kind);
		// Native alerts already land in the mod log, so delete / log-only need nothing more.
		if (!config || config.action === 'log' || config.action === 'delete') return;
		const member = await fetchMember(guild, execution.userId);
		if (!member || isImmune(member)) return;
		const detail = execution.matchedKeyword ? `\`${execution.matchedKeyword}\` (Discord AutoMod)` : 'blocked by Discord AutoMod';
		await punish(guild, member, config, { rule: config.rule, detail }, { channelId: execution.channelId ?? '', content: execution.content });
	} catch (error) {
		container.logger.warn(`[automod] native execution handling failed: ${String(error)}`);
	}
}
