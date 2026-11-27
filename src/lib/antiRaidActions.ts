import { container } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	type Client,
	type Guild,
	type GuildMember,
	type SendableChannels
} from 'discord.js';
import {
	CaptchaStore,
	JoinRateTracker,
	countRaidJoin,
	endRaid,
	expiredRaids,
	formatJoinAction,
	getAntiRaidConfig,
	isRaidActive,
	makeCaptchaCode,
	screenJoin,
	startRaid,
	type AntiRaidConfig,
	type JoinVerdict
} from './antiRaid';
import { MOD_PREFIX } from './modButtons';
import { ModError, actWithCase, recordCase } from './modActions';
import { lockServer, summarize, unlockServer } from './modLock';
import { formatDuration, getModConfig } from './moderation';

const tracker = new JoinRateTracker();
export const captchas = new CaptchaStore();

const TICK_MS = 30_000;
let ticker: NodeJS.Timeout | null = null;

function botId(): string {
	return container.client.user?.id ?? '0';
}

/** The alert channel, falling back to the mod-log channel. */
async function alertChannel(guild: Guild, config: AntiRaidConfig): Promise<SendableChannels | null> {
	const id = config.alert_channel_id ?? getModConfig(guild.id).log_channel_id;
	if (!id) return null;
	const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
	return channel?.isSendable() ? channel : null;
}

async function alert(
	guild: Guild,
	config: AntiRaidConfig,
	payload: { content?: string; embeds?: EmbedBuilder[]; ping?: boolean; endButton?: boolean }
) {
	const channel = await alertChannel(guild, config);
	if (!channel) return;
	const ping = payload.ping && config.alert_role_id ? `<@&${config.alert_role_id}> ` : '';
	await channel
		.send({
			content: `${ping}${payload.content ?? ''}` || undefined,
			embeds: payload.embeds,
			components: payload.endButton
				? [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder().setCustomId(`${MOD_PREFIX}raid:end`).setLabel('End raid mode').setStyle(ButtonStyle.Danger)
						)
					]
				: [],
			allowedMentions: { roles: payload.ping && config.alert_role_id ? [config.alert_role_id] : [] }
		})
		.catch((error) => container.logger.warn(`[antiraid] couldn't post an alert in ${guild.id}: ${String(error)}`));
}

/** Turns raid mode on: optional server lockdown, a case, and an alert. */
export async function triggerRaid(guild: Guild, config: AntiRaidConfig, joins: number): Promise<void> {
	const until = new Date(Date.now() + config.raid_duration_ms);
	startRaid(guild.id, until, false);
	const reason = `Anti-raid: ${joins} joins in ${formatDuration(config.join_window_ms)}`;
	let lockLine = 'Server not locked (lockdown is off).';
	if (config.raid_lockdown) {
		const result = await lockServer(guild, reason);
		startRaid(guild.id, until, true);
		await recordCase(guild, {
			action: 'lock',
			targetType: 'guild',
			targetId: guild.id,
			moderatorId: botId(),
			moderatorTag: 'Lyra (anti-raid)',
			reason
		});
		lockLine = `Locked ${summarize(result)}.`;
	}
	container.logger.warn(`[antiraid] raid mode on in ${guild.id}: ${reason}`);
	await alert(guild, config, {
		ping: true,
		endButton: true,
		embeds: [
			new EmbedBuilder()
				.setColor(Colors.Red)
				.setTitle('🚨 Raid detected')
				.setDescription(
					[
						`**${joins}** members joined within ${formatDuration(config.join_window_ms)}.`,
						lockLine,
						`New members until it ends: **${formatJoinAction(config.raid_join_action)}**.`,
						`Raid mode ends <t:${Math.floor(until.getTime() / 1000)}:R>, or press the button / run \`/antiraid end\`.`
					].join('\n')
				)
				.setTimestamp()
		]
	});
}

/** Ends raid mode (button, command or timer) and unlocks what raid mode locked. */
export async function endRaidMode(guild: Guild, endedBy: string | null): Promise<string> {
	const config = getAntiRaidConfig(guild.id);
	const ended = endRaid(guild.id);
	if (!ended) throw new ModError("raid mode isn't on.");
	tracker.reset(guild.id);
	let unlockLine = '';
	if (ended.locked) {
		const reason = endedBy ? 'Anti-raid: raid mode ended by a moderator' : 'Anti-raid: raid mode expired';
		const result = await unlockServer(guild, reason);
		await recordCase(guild, {
			action: 'unlock',
			targetType: 'guild',
			targetId: guild.id,
			moderatorId: endedBy ?? botId(),
			moderatorTag: endedBy ? null : 'Lyra (anti-raid)',
			reason
		});
		unlockLine = ` Unlocked ${summarize(result)}.`;
	}
	const who = endedBy ? `by <@${endedBy}>` : '(timer ran out)';
	const text = `✅ Raid mode ended ${who}. ${ended.joins} member(s) joined during it.${unlockLine}`;
	await alert(guild, config, { content: text });
	return text;
}

async function applyVerdict(member: GuildMember, config: AntiRaidConfig, verdict: JoinVerdict): Promise<boolean> {
	const reason = `Anti-raid: ${verdict.reason ?? 'screened on join'}`;
	const moderator = { moderatorId: botId(), moderatorTag: 'Lyra (anti-raid)' };
	if (verdict.action === 'quarantine') {
		if (!config.quarantine_role_id) return false;
		await member.roles.add(config.quarantine_role_id, reason);
		return true;
	}
	if (verdict.action === 'kick') {
		if (!member.kickable) return false;
		await actWithCase(member.guild, { action: 'kick', targetId: member.id, targetTag: member.user.username, reason, ...moderator }, () =>
			member.kick(reason)
		);
		return true;
	}
	if (verdict.action === 'ban') {
		if (!member.bannable) return false;
		await actWithCase(member.guild, { action: 'ban', targetId: member.id, targetTag: member.user.username, reason, ...moderator }, () =>
			member.ban({ reason })
		);
		return true;
	}
	return false;
}

/** Everything that happens when someone joins: rate check, then screening. Errors are logged, never thrown. */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
	const { guild } = member;
	let config = getAntiRaidConfig(guild.id);
	if (!config.enabled) return;
	try {
		if (!member.user.bot) {
			const joins = tracker.record(guild.id, config.join_window_ms);
			if (!isRaidActive(config) && joins >= config.join_threshold) {
				await triggerRaid(guild, config, joins);
				config = getAntiRaidConfig(guild.id);
			}
		}
		const raid = isRaidActive(config);
		if (raid) countRaidJoin(guild.id);
		const verdict = screenJoin(config, {
			accountCreatedAt: member.user.createdTimestamp,
			hasDefaultAvatar: member.user.avatar === null,
			isBot: member.user.bot
		});
		if (verdict.action === 'none') return;
		const applied = await applyVerdict(member, config, verdict);
		// One line per join outside a raid; during a raid the end-of-raid summary covers it.
		if (!raid) {
			await alert(guild, config, {
				content: applied
					? `🛡️ ${formatJoinAction(verdict.action)} <@${member.id}> (${member.user.username}) on join: ${verdict.reason}.`
					: `⚠️ wanted to ${verdict.action} <@${member.id}> on join (${verdict.reason}) but Discord wouldn't let me. check my role position.`
			});
		}
	} catch (error) {
		container.logger.warn(`[antiraid] handling ${member.id} joining ${guild.id} failed: ${String(error)}`);
	}
}

export async function expireRaids(client: Client, now = new Date()): Promise<void> {
	for (const guildId of expiredRaids(now)) {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) {
			endRaid(guildId);
			continue;
		}
		await endRaidMode(guild, null).catch((error) => container.logger.warn(`[antiraid] ending raid mode in ${guildId} failed: ${String(error)}`));
	}
}

export function startAntiRaid(client: Client): void {
	if (ticker) return;
	void expireRaids(client);
	ticker = setInterval(() => void expireRaids(client), TICK_MS);
	ticker.unref?.();
}

export function stopAntiRaid(): void {
	if (ticker) clearInterval(ticker);
	ticker = null;
}

// ---------------------------------------------------------------------------------------------
// Verification gate
// ---------------------------------------------------------------------------------------------

export function verifyPanelPayload(guildName: string, mode: AntiRaidConfig['verify_mode']) {
	return {
		embeds: [
			new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle(`Welcome to ${guildName}`)
				.setDescription(
					mode === 'captcha'
						? 'Press **Verify** and type the code you are shown to get access to the server.'
						: 'Press **Verify** to get access to the server.'
				)
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`${MOD_PREFIX}verify:start`).setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success)
			)
		]
	};
}

/** Why this member can't verify right now, or null. */
export function verifyProblem(member: GuildMember, config: AntiRaidConfig): string | null {
	if (!config.verify_role_id && !config.quarantine_role_id) return "verification isn't set up here. tell a moderator.";
	if (isRaidActive(config)) return 'verification is paused while the server is in raid mode. try again in a bit.';
	const hasRole = config.verify_role_id ? member.roles.cache.has(config.verify_role_id) : true;
	const quarantined = config.quarantine_role_id ? member.roles.cache.has(config.quarantine_role_id) : false;
	if (hasRole && !quarantined) return "you're already verified.";
	return null;
}

/** Grants the member role and lifts quarantine. */
export async function completeVerification(member: GuildMember, config: AntiRaidConfig): Promise<string> {
	const reason = 'Passed verification';
	if (config.verify_role_id && !member.roles.cache.has(config.verify_role_id)) await member.roles.add(config.verify_role_id, reason);
	if (config.quarantine_role_id && member.roles.cache.has(config.quarantine_role_id)) await member.roles.remove(config.quarantine_role_id, reason);
	return "✅ you're verified. welcome!";
}

export function issueCaptcha(member: GuildMember): string {
	const code = makeCaptchaCode();
	captchas.issue(member.guild.id, member.id, code);
	return code;
}
