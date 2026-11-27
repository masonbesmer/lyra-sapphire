import {
	AutoModerationActionType,
	AutoModerationRuleEventType,
	AutoModerationRuleTriggerType,
	type AutoModerationActionOptions,
	type AutoModerationRule,
	type AutoModerationTriggerMetadataOptions,
	type Guild
} from 'discord.js';
import { getAutomodSettings, getRule, parseRegexEntry, pickWorst, type AutomodRule, type RuleConfig } from './automod';
import { getModConfig } from './moderation';

/**
 * Mirrors Lyra's word, mention and spam filters into Discord's native AutoMod, which blocks a
 * message before anyone sees it. Native rules only block (and alert the mod-log channel); when one
 * fires, Lyra hears about it (autoModerationActionExecution) and applies the filter's own action
 * (warn, timeout, kick, ban) so it still becomes a case and counts toward warn thresholds.
 *
 * Lyra owns exactly the native rules she created whose name starts with NATIVE_PREFIX. Rules
 * anyone else made are never touched.
 */

export const NATIVE_PREFIX = 'Lyra: ';

export type NativeKind = 'words' | 'mentions' | 'spam';

export const NATIVE_NAMES: Record<NativeKind, string> = {
	words: `${NATIVE_PREFIX}banned words`,
	mentions: `${NATIVE_PREFIX}mention spam`,
	spam: `${NATIVE_PREFIX}spam`
};

/** Discord's limits on native rules. */
const MAX_KEYWORDS = 1000;
const MAX_KEYWORD_LENGTH = 60;
const MAX_REGEX = 10;
const MAX_REGEX_LENGTH = 260;
const MAX_EXEMPT_ROLES = 20;
const MAX_EXEMPT_CHANNELS = 50;
const MAX_MENTION_LIMIT = 50;

export interface NativeRuleSpec {
	kind: NativeKind;
	name: string;
	triggerType: AutoModerationRuleTriggerType;
	triggerMetadata?: AutoModerationTriggerMetadataOptions;
	/** Block the message (anything but log-only), and alert the mod log if there is one. */
	block: boolean;
	exemptRoles: string[];
	exemptChannels: string[];
	/** Entries that couldn't be mirrored (too long, too many), to tell the moderator. */
	skipped: string[];
}

function union(...lists: string[][]): string[] {
	return [...new Set(lists.flat())];
}

/** The Lyra filter(s) a native rule stands for: their action decides what happens when it fires. */
export function sourceRules(guildId: string, kind: NativeKind): RuleConfig[] {
	if (kind === 'words') return [getRule(guildId, 'words')];
	if (kind === 'mentions') return [getRule(guildId, 'mentions')];
	return [getRule(guildId, 'flood'), getRule(guildId, 'duplicates')];
}

/** The enabled source rule with the harshest action. */
export function effectiveSource(guildId: string, kind: NativeKind): RuleConfig | null {
	return (
		pickWorst(
			sourceRules(guildId, kind)
				.filter((rule) => rule.enabled)
				.map((config) => ({ config }))
		)?.config ?? null
	);
}

/** What the native rules should look like for this guild's current settings; null = shouldn't exist. */
export function desiredNativeRules(guildId: string): Record<NativeKind, NativeRuleSpec | null> {
	const settings = getAutomodSettings(guildId);
	const hasLog = getModConfig(guildId).log_channel_id !== null;

	const spec = (
		kind: NativeKind,
		triggerType: AutoModerationRuleTriggerType,
		metadata?: AutoModerationTriggerMetadataOptions,
		skipped: string[] = []
	) => {
		const sources = sourceRules(guildId, kind).filter((rule) => rule.enabled);
		const source = effectiveSource(guildId, kind);
		if (!source) return null;
		const block = source.action !== 'log';
		// A log-only rule with nowhere to log does nothing natively.
		if (!block && !hasLog) return null;
		return {
			kind,
			name: NATIVE_NAMES[kind],
			triggerType,
			triggerMetadata: metadata,
			block,
			exemptRoles: union(settings.exemptRoles, ...sources.map((rule) => rule.exemptRoles)).slice(0, MAX_EXEMPT_ROLES),
			exemptChannels: union(settings.exemptChannels, ...sources.map((rule) => rule.exemptChannels)).slice(0, MAX_EXEMPT_CHANNELS),
			skipped
		} satisfies NativeRuleSpec;
	};

	const words = getRule(guildId, 'words');
	const keywordFilter: string[] = [];
	const regexPatterns: string[] = [];
	const skipped: string[] = [];
	for (const entry of words.settings.words ?? []) {
		const regex = parseRegexEntry(entry);
		if (regex instanceof RegExp) {
			if (regexPatterns.length < MAX_REGEX && regex.source.length <= MAX_REGEX_LENGTH) regexPatterns.push(regex.source);
			else skipped.push(entry);
		} else if (regex === null) {
			if (keywordFilter.length < MAX_KEYWORDS && entry.length <= MAX_KEYWORD_LENGTH) keywordFilter.push(entry);
			else skipped.push(entry);
		}
	}
	const wordsSpec =
		keywordFilter.length || regexPatterns.length
			? spec('words', AutoModerationRuleTriggerType.Keyword, { keywordFilter, regexPatterns }, skipped)
			: null;

	const mentions = getRule(guildId, 'mentions');
	const mentionsSpec = spec('mentions', AutoModerationRuleTriggerType.MentionSpam, {
		mentionTotalLimit: Math.min(Math.max(mentions.settings.limit ?? 5, 1), MAX_MENTION_LIMIT)
	});

	return { words: wordsSpec, mentions: mentionsSpec, spam: spec('spam', AutoModerationRuleTriggerType.Spam) };
}

function nativeActions(spec: NativeRuleSpec, logChannelId: string | null): AutoModerationActionOptions[] {
	const actions: AutoModerationActionOptions[] = [];
	if (spec.block) actions.push({ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Blocked by the server’s AutoMod.' } });
	if (logChannelId) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: logChannelId } });
	return actions;
}

/** Lyra's own native rules in the guild, by kind. */
export async function lyraNativeRules(guild: Guild): Promise<Map<NativeKind, AutoModerationRule>> {
	const rules = await guild.autoModerationRules.fetch();
	const botId = guild.client.user?.id;
	const ours = new Map<NativeKind, AutoModerationRule>();
	for (const rule of rules.values()) {
		if (rule.creatorId !== botId || !rule.name.startsWith(NATIVE_PREFIX)) continue;
		const kind = (Object.keys(NATIVE_NAMES) as NativeKind[]).find((key) => NATIVE_NAMES[key] === rule.name);
		if (kind) ours.set(kind, rule);
	}
	return ours;
}

export function nativeKindOf(ruleName: string): NativeKind | null {
	return (Object.keys(NATIVE_NAMES) as NativeKind[]).find((key) => NATIVE_NAMES[key] === ruleName) ?? null;
}

export interface SyncReport {
	created: NativeKind[];
	updated: NativeKind[];
	removed: NativeKind[];
	failed: { kind: NativeKind; error: string }[];
	skipped: string[];
}

/**
 * Creates, updates or deletes Lyra's native rules to match the current settings. With `remove`
 * (native sync turned off), deletes all of them. Errors per rule are collected, not thrown.
 */
export async function syncNativeRules(guild: Guild, options: { remove?: boolean; reason?: string } = {}): Promise<SyncReport> {
	const report: SyncReport = { created: [], updated: [], removed: [], failed: [], skipped: [] };
	const existing = await lyraNativeRules(guild);
	const desired = options.remove ? { words: null, mentions: null, spam: null } : desiredNativeRules(guild.id);
	const logChannelId = getModConfig(guild.id).log_channel_id;
	const reason = options.reason ?? 'Lyra AutoMod sync';

	for (const kind of Object.keys(NATIVE_NAMES) as NativeKind[]) {
		const spec = desired[kind];
		const current = existing.get(kind);
		try {
			if (!spec) {
				if (current) {
					await current.delete(reason);
					report.removed.push(kind);
				}
				continue;
			}
			report.skipped.push(...spec.skipped);
			const data = {
				name: spec.name,
				eventType: AutoModerationRuleEventType.MessageSend,
				triggerMetadata: spec.triggerMetadata,
				actions: nativeActions(spec, logChannelId),
				enabled: true,
				exemptRoles: spec.exemptRoles,
				exemptChannels: spec.exemptChannels,
				reason
			};
			if (current) {
				// The trigger type can't change on an existing rule; everything else can.
				await current.edit(data);
				report.updated.push(kind);
			} else {
				await guild.autoModerationRules.create({ ...data, triggerType: spec.triggerType });
				report.created.push(kind);
			}
		} catch (error) {
			report.failed.push({ kind, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return report;
}

export function describeSyncReport(report: SyncReport): string {
	const lines: string[] = [];
	if (report.created.length) lines.push(`created: ${report.created.join(', ')}`);
	if (report.updated.length) lines.push(`updated: ${report.updated.join(', ')}`);
	if (report.removed.length) lines.push(`removed: ${report.removed.join(', ')}`);
	for (const failure of report.failed) lines.push(`⚠️ ${failure.kind} failed: ${failure.error}`);
	if (report.skipped.length)
		lines.push(`-# not mirrored (too long or over Discord's limits, still checked by Lyra): ${report.skipped.slice(0, 10).join(', ')}`);
	return lines.length ? lines.join('\n') : 'nothing to change.';
}

/** Which Lyra filters feed a native rule, for help text. */
export const NATIVE_SOURCES: Record<NativeKind, AutomodRule[]> = {
	words: ['words'],
	mentions: ['mentions'],
	spam: ['flood', 'duplicates']
};
