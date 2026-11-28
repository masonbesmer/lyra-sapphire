import { container } from '@sapphire/framework';
import {
	ChatInputCommandInteraction,
	Colors,
	DiscordAPIError,
	EmbedBuilder,
	GuildMember,
	MessageFlags,
	RESTJSONErrorCodes,
	type Guild,
	type Message,
	type Role,
	type User
} from 'discord.js';
import { appealComponents } from './modButtons';
import {
	ACTION_LABELS,
	ACTION_VERBS,
	createCase,
	deleteCase,
	formatDuration,
	formatTarget,
	getModConfig,
	hierarchyProblem,
	isDmAction,
	roleProblem,
	setCaseLogMessage,
	shouldDm,
	type ModAction,
	type ModCase,
	type NewModCase
} from './moderation';

/** A refusal the moderator should see as-is (bad input, hierarchy, missing target). */
export class ModError extends Error {}

const ACTION_COLORS: Record<ModAction, number> = {
	warn: Colors.Yellow,
	timeout: Colors.Orange,
	untimeout: Colors.Green,
	kick: Colors.DarkOrange,
	ban: Colors.Red,
	unban: Colors.Green,
	softban: Colors.DarkRed,
	purge: Colors.Blurple,
	slowmode: Colors.Blurple,
	lock: Colors.DarkGrey,
	unlock: Colors.Green,
	nick: Colors.Blue,
	'role-add': Colors.Blue,
	'role-remove': Colors.Blue,
	vmute: Colors.Orange,
	vunmute: Colors.Green,
	vdeafen: Colors.Orange,
	vundeafen: Colors.Green,
	vkick: Colors.DarkOrange,
	vmove: Colors.Blue
};

export function userTag(user: User): string {
	return user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : user.username;
}

/** Resolves a member of the guild, or null if they aren't in it. Other API errors propagate. */
export async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
	const cached = guild.members.cache.get(userId);
	if (cached) return cached;
	try {
		return await guild.members.fetch(userId);
	} catch (error) {
		if (error instanceof DiscordAPIError && (error.code === RESTJSONErrorCodes.UnknownMember || error.code === RESTJSONErrorCodes.UnknownUser)) {
			return null;
		}
		throw error;
	}
}

async function botMember(guild: Guild): Promise<GuildMember> {
	return guild.members.me ?? guild.members.fetchMe();
}

/** Throws a ModError if role hierarchy forbids `moderator` acting on `target`. */
export async function assertCanModerate(moderator: GuildMember, target: GuildMember | null, targetUserId?: string): Promise<void> {
	const guild = moderator.guild;
	const me = await botMember(guild);
	const problem = hierarchyProblem({
		guildOwnerId: guild.ownerId,
		moderator: { id: moderator.id, highest: moderator.roles.highest.position },
		bot: { id: me.id, highest: me.roles.highest.position },
		target: target ? { id: target.id, highest: target.roles.highest.position } : null
	});
	if (problem) throw new ModError(problem);
	// Not a member, so there's no role to compare, but self-targeting still makes no sense.
	if (!target && targetUserId) {
		if (targetUserId === moderator.id) throw new ModError("you can't use that on yourself.");
		if (targetUserId === me.id) throw new ModError("I'm not doing that to myself.");
	}
}

export async function assertCanManageRole(moderator: GuildMember, role: Role): Promise<void> {
	const me = await botMember(moderator.guild);
	const problem = roleProblem({
		guildOwnerId: moderator.guild.ownerId,
		moderator: { id: moderator.id, highest: moderator.roles.highest.position },
		bot: { id: me.id, highest: me.roles.highest.position },
		role: { id: role.id, position: role.position, managed: role.managed, guildId: moderator.guild.id }
	});
	if (problem) throw new ModError(problem);
}

/**
 * DMs the target about an action, if the guild has DMs on for it. Must run *before* a kick
 * or ban: once they've left the guild the bot usually shares no server with them and Discord
 * refuses the DM. Returns whether the DM went through (closed DMs are normal, not an error).
 */
export async function notifyTarget(
	guild: Guild,
	user: User,
	action: ModAction,
	details: { caseNumber: number; reason: string | null; durationMs?: number | null }
): Promise<boolean> {
	if (!isDmAction(action) || !shouldDm(guild.id, action)) return false;
	const lines = [`You were **${ACTION_VERBS[action]}** **${guild.name}**.`];
	if (details.durationMs) lines.push(`**Duration:** ${formatDuration(details.durationMs)}`);
	lines.push(`**Reason:** ${details.reason ?? 'No reason given'}`);
	lines.push(`-# Case #${details.caseNumber}`);
	// A ban DM carries the appeal button/link, since it is the one message a banned member keeps.
	const components = action === 'ban' ? appealComponents(guild.id) : [];
	try {
		await user.send({ content: lines.join('\n'), components, allowedMentions: { parse: [] } });
		return true;
	} catch {
		return false;
	}
}

export function buildCaseEmbed(modCase: ModCase, extra: { name: string; value: string }[] = []): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(ACTION_COLORS[modCase.action] ?? Colors.Grey)
		.setTitle(`${ACTION_LABELS[modCase.action] ?? modCase.action} | Case #${modCase.case_number}`)
		.addFields(
			{ name: modCase.target_type === 'user' ? 'User' : 'Target', value: formatTarget(modCase), inline: true },
			{
				name: 'Moderator',
				value: modCase.moderator_tag ? `<@${modCase.moderator_id}> (${modCase.moderator_tag})` : `<@${modCase.moderator_id}>`,
				inline: true
			}
		);
	if (modCase.duration_ms) embed.addFields({ name: 'Duration', value: formatDuration(modCase.duration_ms), inline: true });
	if (modCase.expires_at) {
		embed.addFields({ name: 'Expires', value: `<t:${Math.floor(new Date(modCase.expires_at).getTime() / 1000)}:R>`, inline: true });
	}
	embed.addFields({ name: 'Reason', value: modCase.reason ?? '_No reason given_' }, ...extra);
	if (modCase.target_type === 'user') embed.setFooter({ text: `User ID: ${modCase.target_id}` });
	embed.setTimestamp(new Date(modCase.created_at));
	return embed;
}

/** Posts a case to the guild's mod-log channel, if one is set. Failures are logged, never thrown. */
export async function postModLog(guild: Guild, modCase: ModCase, extra: { name: string; value: string }[] = []): Promise<void> {
	const { log_channel_id } = getModConfig(guild.id);
	if (!log_channel_id) return;
	try {
		const channel = guild.channels.cache.get(log_channel_id) ?? (await guild.channels.fetch(log_channel_id));
		if (!channel?.isSendable()) return;
		const sent = await channel.send({ embeds: [buildCaseEmbed(modCase, extra)], allowedMentions: { parse: [] } });
		setCaseLogMessage(guild.id, modCase.case_number, channel.id, sent.id);
	} catch (error) {
		container.logger.warn(`[moderation] couldn't post case #${modCase.case_number} to the mod log in ${guild.id}: ${String(error)}`);
	}
}

/** Edits an existing mod-log entry after its case changed. Best-effort. */
export async function refreshModLog(guild: Guild, modCase: ModCase): Promise<void> {
	if (!modCase.log_channel_id || !modCase.log_message_id) return;
	try {
		const channel = guild.channels.cache.get(modCase.log_channel_id) ?? (await guild.channels.fetch(modCase.log_channel_id));
		if (!channel?.isTextBased()) return;
		const message = await channel.messages.fetch(modCase.log_message_id);
		await message.edit({ embeds: [buildCaseEmbed(modCase)] });
	} catch (error) {
		container.logger.debug(`[moderation] couldn't refresh the mod-log entry for case #${modCase.case_number}: ${String(error)}`);
	}
}

/** Creates the case and posts it to the mod log. */
export async function recordCase(guild: Guild, input: Omit<NewModCase, 'guildId'>, extra: { name: string; value: string }[] = []): Promise<ModCase> {
	const modCase = createCase({ ...input, guildId: guild.id });
	await postModLog(guild, modCase, extra);
	return modCase;
}

export interface ActWithCaseOptions {
	/** DM this user about the action (if the guild has DMs on for it) before it is applied. */
	notify?: User;
	/** Extra fields for the mod-log embed. */
	extra?: { name: string; value: string }[];
}

/**
 * The shape every case-creating action follows: reserve the case number, DM the target with it,
 * apply the action, then post to the mod log. The DM has to land before a kick or ban, since
 * afterwards the bot usually shares no server with them. If the action fails the case is
 * deleted again (its number stays unused), so a refused action never leaves a case behind.
 */
export async function actWithCase(
	guild: Guild,
	input: Omit<NewModCase, 'guildId'>,
	act: () => Promise<unknown>,
	options: ActWithCaseOptions = {}
): Promise<{ modCase: ModCase; dm: boolean | undefined }> {
	const modCase = createCase({ ...input, guildId: guild.id });
	const dm = options.notify
		? await notifyTarget(guild, options.notify, input.action, {
				caseNumber: modCase.case_number,
				reason: modCase.reason,
				durationMs: modCase.duration_ms
			})
		: undefined;
	try {
		await act();
	} catch (error) {
		deleteCase(guild.id, modCase.case_number);
		throw error;
	}
	await postModLog(guild, modCase, options.extra);
	return { modCase, dm };
}

/** Discord audit-log reasons: who did it through the bot, then why. */
export function auditReason(moderator: User, reason: string | null): string {
	return `${userTag(moderator)}: ${reason ?? 'No reason given'}`.slice(0, 512);
}

export function caseSuffix(modCase: ModCase, dmSent?: boolean): string {
	const dm = dmSent === undefined ? '' : dmSent ? ' · DM sent' : '';
	return `-# Case #${modCase.case_number}${dm}`;
}

/** Turns anything a command throws into the text the moderator sees. */
export function describeError(error: unknown): string {
	if (error instanceof ModError) return error.message;
	if (error instanceof DiscordAPIError) {
		if (error.code === RESTJSONErrorCodes.MissingPermissions) return "Discord says I'm missing a permission for that.";
		if (error.code === RESTJSONErrorCodes.UnknownBan) return "that user isn't banned.";
		if (error.code === RESTJSONErrorCodes.UnknownMember) return "they aren't in this server.";
		if (error.code === RESTJSONErrorCodes.UnknownUser) return "Discord doesn't know that user.";
	}
	container.logger.error(`[moderation] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	return 'something went wrong, check the logs.';
}

export interface RespondOptions {
	/** Defer first, for actions that may take longer than Discord's 3-second window. */
	defer?: boolean;
	/** Keep the success reply private too. Refusals are always private where Discord allows it. */
	ephemeral?: boolean;
}

export type ModReply = string | { content?: string; embeds: EmbedBuilder[] };

/**
 * Runs a moderation action and replies with its result. Commands put their work in `run` and
 * return the success reply, throwing a ModError for refusals, so both command styles reply alike.
 */
export async function respond(
	target: ChatInputCommandInteraction | Message,
	run: () => Promise<ModReply>,
	options: RespondOptions = {}
): Promise<unknown> {
	let reply: ModReply;
	let failed = false;
	if (target instanceof ChatInputCommandInteraction && options.defer) {
		await target.deferReply(options.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
	}
	try {
		reply = await run();
	} catch (error) {
		reply = `❌ ${describeError(error)}`;
		failed = true;
	}
	const payload = { ...(typeof reply === 'string' ? { content: reply } : reply), allowedMentions: { parse: [] } };

	if (target instanceof ChatInputCommandInteraction) {
		if (target.deferred || target.replied) return target.editReply(payload);
		return target.reply({ ...payload, flags: failed || options.ephemeral ? MessageFlags.Ephemeral : undefined });
	}
	return target.reply(payload);
}

/** `<@123>`, `<@!123>`, `<#123>`, `<@&123>` or a bare ID → the ID. */
export function snowflakeFrom(text: string | null | undefined): string | null {
	const match = text?.match(/^(?:<(?:@[!&]?|#))?(\d{17,20})>?$/);
	return match ? match[1] : null;
}
