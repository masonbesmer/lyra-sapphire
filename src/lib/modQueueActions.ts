import { container } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Colors,
	EmbedBuilder,
	PermissionFlagsBits,
	ThreadAutoArchiveDuration,
	type ButtonInteraction,
	type Guild,
	type GuildMember,
	type Message,
	type ThreadChannel,
	type User
} from 'discord.js';
import { MOD_PREFIX } from './modButtons';
import { ModError, actWithCase, assertCanModerate, auditReason, fetchMember, userTag } from './modActions';
import { cancelScheduledAction } from './moderation';
import {
	REPORT_LIMIT,
	appealBlocker,
	closeReport,
	closeTicket,
	createAppeal,
	createReport,
	createTicket,
	decideAppeal,
	findOpenDuplicate,
	getAppeal,
	getModQueueConfig,
	getOpenTicket,
	getReport,
	getTicketByThread,
	latestAppeal,
	recentReportCount,
	reopenAppeal,
	setAppealQueueMessage,
	setReportQueueMessage,
	ticketThreadName,
	type ModAppeal,
	type ModReport
} from './modQueue';

export const REPORT_TIMEOUT_MS = 60 * 60 * 1000;

async function sendableChannel(guild: Guild, channelId: string | null) {
	if (!channelId) return null;
	const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
	return channel?.isSendable() ? channel : null;
}

function requirePermission(member: GuildMember, permission: bigint, label: string): void {
	if (!member.permissions.has(permission)) throw new ModError(`you need **${label}** for that.`);
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export interface ReportInput {
	guild: Guild;
	reporter: User;
	target: User;
	reason: string;
	message?: Message | null;
}

function reportEmbed(report: ModReport, handled?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(report.status === 'open' ? Colors.Orange : report.status === 'resolved' ? Colors.Green : Colors.Grey)
		.setTitle(`Report #${report.id}`)
		.addFields(
			{ name: 'Reported', value: report.target_tag ? `<@${report.target_id}> (${report.target_tag})` : `<@${report.target_id}>`, inline: true },
			{ name: 'By', value: `<@${report.reporter_id}>`, inline: true },
			{ name: 'Reason', value: report.reason }
		)
		.setFooter({ text: `User ID: ${report.target_id}` })
		.setTimestamp(new Date(report.created_at));
	if (report.message_id && report.channel_id) {
		const link = `https://discord.com/channels/${report.guild_id}/${report.channel_id}/${report.message_id}`;
		embed.addFields({ name: 'Message', value: `${report.message_content ? `>>> ${report.message_content}\n` : ''}[Jump to message](${link})` });
	}
	if (handled) embed.addFields({ name: 'Handled', value: handled });
	return embed;
}

function reportButtons(report: ModReport, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${MOD_PREFIX}report:warn:${report.id}`)
			.setLabel('Warn')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${MOD_PREFIX}report:timeout:${report.id}`)
			.setLabel('Timeout 1h')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(disabled)
	);
	if (report.message_id) {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId(`${MOD_PREFIX}report:delete:${report.id}`)
				.setLabel('Delete message')
				.setStyle(ButtonStyle.Danger)
				.setDisabled(disabled)
		);
	}
	row.addComponents(
		new ButtonBuilder()
			.setCustomId(`${MOD_PREFIX}report:resolve:${report.id}`)
			.setLabel('Resolve')
			.setStyle(ButtonStyle.Success)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${MOD_PREFIX}report:dismiss:${report.id}`)
			.setLabel('Dismiss')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(disabled)
	);
	return [row];
}

/** Files a report into the mod queue and returns what the reporter sees (always privately). */
export async function fileReport({ guild, reporter, target, reason, message }: ReportInput): Promise<string> {
	const config = getModQueueConfig(guild.id);
	const channel = await sendableChannel(guild, config.report_channel_id);
	if (!channel) throw new ModError("this server hasn't set up reports.");
	if (target.id === reporter.id) throw new ModError("you can't report yourself.");
	if (target.id === container.client.user?.id) throw new ModError('nice try.');
	if (!reason.trim()) throw new ModError('say what the problem is.');
	if (findOpenDuplicate(guild.id, reporter.id, target.id, message?.id ?? null))
		throw new ModError('you already reported that. the moderators have it.');
	if (recentReportCount(guild.id, reporter.id) >= REPORT_LIMIT)
		throw new ModError("you've sent a lot of reports just now. try again in a few minutes.");

	const report = createReport({
		guildId: guild.id,
		reporterId: reporter.id,
		targetId: target.id,
		targetTag: userTag(target),
		reason,
		channelId: message?.channelId ?? null,
		messageId: message?.id ?? null,
		messageContent: message ? message.content || (message.attachments.size ? `[${message.attachments.size} attachment(s)]` : null) : null
	});
	const sent = await channel.send({ embeds: [reportEmbed(report)], components: reportButtons(report), allowedMentions: { parse: [] } });
	setReportQueueMessage(guild.id, report.id, sent.id);
	return `📨 thanks, report #${report.id} went to the moderators.`;
}

/** A click on one of the buttons under a report. Returns the private reply for the moderator. */
export async function handleReportButton(interaction: ButtonInteraction<'cached'>, action: string, reportId: number): Promise<string> {
	const { guild, member } = interaction;
	const report = getReport(guild.id, reportId);
	if (!report) throw new ModError('that report is gone.');

	if (action === 'delete') {
		requirePermission(member, PermissionFlagsBits.ManageMessages, 'Manage Messages');
		if (!report.channel_id || !report.message_id) throw new ModError('that report has no message.');
		const channel = guild.channels.cache.get(report.channel_id);
		if (!channel?.isTextBased()) throw new ModError("I can't find that channel anymore.");
		const deleted = await channel.messages.delete(report.message_id).then(
			() => true,
			() => false
		);
		return deleted ? '🗑️ deleted the reported message.' : 'that message is already gone.';
	}

	requirePermission(member, PermissionFlagsBits.ModerateMembers, 'Moderate Members');
	if (report.status !== 'open') throw new ModError(`report #${report.id} was already ${report.status}.`);

	let outcome: string;
	if (action === 'warn' || action === 'timeout') {
		const target = await fetchMember(guild, report.target_id);
		if (!target) throw new ModError("they aren't in this server anymore.");
		await assertCanModerate(member, target);
		if (action === 'timeout' && !target.moderatable) throw new ModError("Discord won't let me time them out.");
		const reason = `Report #${report.id}: ${report.reason}`;
		const { modCase } = await actWithCase(
			guild,
			{
				action,
				targetId: target.id,
				targetTag: target.user.username,
				moderatorId: member.id,
				moderatorTag: member.user.username,
				reason,
				durationMs: action === 'timeout' ? REPORT_TIMEOUT_MS : null
			},
			async () => {
				if (action === 'timeout') await target.timeout(REPORT_TIMEOUT_MS, auditReason(member.user, reason));
			},
			{ notify: target.user }
		);
		outcome = `${action === 'warn' ? 'Warned' : 'Timed out for 1h'} by <@${member.id}> (case #${modCase.case_number})`;
	} else if (action === 'resolve') {
		outcome = `Resolved by <@${member.id}>`;
	} else if (action === 'dismiss') {
		outcome = `Dismissed by <@${member.id}>`;
	} else {
		throw new ModError("I don't know that button.");
	}

	if (!closeReport(guild.id, report.id, action === 'dismiss' ? 'dismissed' : 'resolved', member.id)) {
		throw new ModError(`someone else handled report #${report.id} first.`);
	}
	const closed = getReport(guild.id, report.id)!;
	await interaction.message.edit({ embeds: [reportEmbed(closed, outcome)], components: reportButtons(closed, true) }).catch(() => undefined);
	return `✅ report #${report.id}: ${outcome.charAt(0).toLowerCase()}${outcome.slice(1)}.`;
}

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

export function ticketPanelPayload(guildName: string) {
	return {
		embeds: [
			new EmbedBuilder()
				.setColor(Colors.Blurple)
				.setTitle('Contact the moderators')
				.setDescription(
					`Need help in **${guildName}** or want to talk to staff privately? Press the button and a private thread opens with the moderators.`
				)
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`${MOD_PREFIX}ticket:open`).setLabel('Open a ticket').setEmoji('📩').setStyle(ButtonStyle.Primary)
			)
		]
	};
}

function closeButton() {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`${MOD_PREFIX}ticket:close`).setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
	);
}

export interface OpenTicketResult {
	thread: ThreadChannel;
	existing: boolean;
}

/**
 * Opens a private thread between the member and staff in the ticket channel, or returns their
 * open one. Staff join by being mentioned (a role mention in a private thread adds the role's
 * members who can see the channel).
 */
export async function openTicket(guild: Guild, user: User, subject: string | null, openingText: string | null = null): Promise<OpenTicketResult> {
	const config = getModQueueConfig(guild.id);
	if (!config.ticket_channel_id) throw new ModError(`**${guild.name}** hasn't set up tickets.`);
	const parent = guild.channels.cache.get(config.ticket_channel_id) ?? (await guild.channels.fetch(config.ticket_channel_id).catch(() => null));
	if (parent?.type !== ChannelType.GuildText) throw new ModError("the ticket channel is gone or isn't a text channel. tell a moderator.");

	const open = getOpenTicket(guild.id, user.id);
	if (open) {
		const thread = await guild.channels.fetch(open.thread_id).catch(() => null);
		if (thread?.isThread() && !thread.locked) {
			if (thread.archived) await thread.setArchived(false).catch(() => undefined);
			return { thread, existing: true };
		}
		// The thread was deleted or locked by hand; forget it and open a fresh one.
		closeTicket(open.thread_id, container.client.user?.id ?? 'unknown');
	}

	const thread = await parent.threads.create({
		name: ticketThreadName(user.username, subject),
		type: ChannelType.PrivateThread,
		invitable: false,
		autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
		reason: `Ticket for ${userTag(user)}`
	});
	createTicket(guild.id, user.id, thread.id, subject);
	await thread.members.add(user.id);

	const staff = config.staff_role_id ? `<@&${config.staff_role_id}>` : 'the moderators';
	const lines = [
		`📩 Ticket opened by <@${user.id}>${subject ? `: **${subject}**` : ''}.`,
		`${staff} will be with you here. Only you and staff can see this thread.`
	];
	if (openingText) lines.push('', `>>> ${openingText.slice(0, 1500)}`);
	await thread.send({
		content: lines.join('\n'),
		components: [closeButton()],
		allowedMentions: { users: [user.id], roles: config.staff_role_id ? [config.staff_role_id] : [] }
	});
	return { thread, existing: false };
}

/** Closes a ticket thread: the member who opened it or anyone with Manage Threads may. */
export async function closeTicketThread(thread: ThreadChannel, closer: GuildMember, reason: string | null): Promise<string> {
	const ticket = getTicketByThread(thread.id);
	if (!ticket) throw new ModError("this isn't a ticket thread.");
	if (ticket.status !== 'open') throw new ModError('this ticket is already closed.');
	const config = getModQueueConfig(thread.guild.id);
	const isStaff =
		closer.permissions.has(PermissionFlagsBits.ManageThreads) || (config.staff_role_id !== null && closer.roles.cache.has(config.staff_role_id));
	if (closer.id !== ticket.user_id && !isStaff) throw new ModError('only the member who opened it or staff can close this ticket.');
	if (!closeTicket(thread.id, closer.id)) throw new ModError('this ticket is already closed.');
	await thread.send({ content: `🔒 Ticket closed by <@${closer.id}>${reason ? `: ${reason}` : ''}.`, allowedMentions: { parse: [] } });
	await thread.setLocked(true, `Ticket closed by ${userTag(closer.user)}`).catch(() => undefined);
	await thread.setArchived(true).catch(() => undefined);
	return '🔒 ticket closed.';
}

/** Servers this user shares with Lyra that take tickets, for the DM modmail prompt. */
export async function ticketGuildsFor(user: User): Promise<Guild[]> {
	const guilds: Guild[] = [];
	for (const guild of container.client.guilds.cache.values()) {
		if (!getModQueueConfig(guild.id).ticket_channel_id) continue;
		const member = await fetchMember(guild, user.id).catch(() => null);
		if (member) guilds.push(guild);
	}
	return guilds;
}

/** The buttons offered in DMs: one per server (Discord allows 5 per row, 5 rows). */
export function dmTicketPrompt(guilds: Guild[], messageId: string) {
	const buttons = guilds
		.slice(0, 25)
		.map((guild) =>
			new ButtonBuilder()
				.setCustomId(`${MOD_PREFIX}ticket:dm:${guild.id}:${messageId}`)
				.setLabel(guild.name.slice(0, 80))
				.setStyle(ButtonStyle.Primary)
		);
	const rows: ActionRowBuilder<ButtonBuilder>[] = [];
	for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
	return {
		content:
			guilds.length === 1
				? `Want to send this to the **${guilds[0].name}** moderators? I'll open a private ticket thread there with your message.`
				: "Which server should I send this to? I'll open a private ticket thread there with your message.",
		components: rows
	};
}

// ---------------------------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------------------------

/** Checks a banned user may appeal to this guild; returns the guild. */
export async function assertCanAppeal(guildId: string, user: User): Promise<Guild> {
	const guild = container.client.guilds.cache.get(guildId);
	if (!guild) throw new ModError("I'm not in that server anymore.");
	if (!getModQueueConfig(guild.id).appeal_channel_id) throw new ModError(`**${guild.name}** isn't taking appeals here.`);
	const ban = await guild.bans.fetch({ user: user.id, force: true }).catch(() => null);
	if (!ban) throw new ModError(`you aren't banned from **${guild.name}**.`);
	const blocker = appealBlocker(latestAppeal(guild.id, user.id));
	if (blocker) throw new ModError(blocker);
	return guild;
}

function appealEmbed(appeal: ModAppeal, banReason: string | null, handled?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(appeal.status === 'pending' ? Colors.Yellow : appeal.status === 'accepted' ? Colors.Green : Colors.Red)
		.setTitle(`Ban appeal #${appeal.id}`)
		.addFields(
			{ name: 'User', value: appeal.user_tag ? `<@${appeal.user_id}> (${appeal.user_tag})` : `<@${appeal.user_id}>`, inline: true },
			{ name: 'Ban reason', value: banReason?.slice(0, 1024) || '_none recorded_', inline: true },
			{ name: 'Appeal', value: appeal.content.slice(0, 1024) }
		)
		.setFooter({ text: `User ID: ${appeal.user_id}` })
		.setTimestamp(new Date(appeal.created_at));
	if (handled) embed.addFields({ name: 'Decision', value: handled });
	return embed;
}

function appealButtons(appeal: ModAppeal, disabled = false) {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`${MOD_PREFIX}appeal:accept:${appeal.id}`)
				.setLabel('Accept (unban)')
				.setStyle(ButtonStyle.Success)
				.setDisabled(disabled),
			new ButtonBuilder()
				.setCustomId(`${MOD_PREFIX}appeal:deny:${appeal.id}`)
				.setLabel('Deny')
				.setStyle(ButtonStyle.Danger)
				.setDisabled(disabled)
		)
	];
}

export async function submitAppeal(guildId: string, user: User, content: string): Promise<string> {
	const guild = await assertCanAppeal(guildId, user);
	const channel = await sendableChannel(guild, getModQueueConfig(guild.id).appeal_channel_id);
	if (!channel) throw new ModError(`**${guild.name}**'s appeal channel is gone. try again later.`);
	const ban = await guild.bans.fetch({ user: user.id }).catch(() => null);
	const appeal = createAppeal(guild.id, user.id, userTag(user), content);
	const sent = await channel.send({
		embeds: [appealEmbed(appeal, ban?.reason ?? null)],
		components: appealButtons(appeal),
		allowedMentions: { parse: [] }
	});
	setAppealQueueMessage(guild.id, appeal.id, sent.id);
	return `📨 your appeal went to the **${guild.name}** moderators. I'll DM you when they decide.`;
}

export async function handleAppealButton(interaction: ButtonInteraction<'cached'>, action: string, appealId: number): Promise<string> {
	const { guild, member } = interaction;
	requirePermission(member, PermissionFlagsBits.BanMembers, 'Ban Members');
	const appeal = getAppeal(guild.id, appealId);
	if (!appeal) throw new ModError('that appeal is gone.');
	if (action !== 'accept' && action !== 'deny') throw new ModError("I don't know that button.");
	if (!decideAppeal(guild.id, appeal.id, action === 'accept' ? 'accepted' : 'denied', member.id)) {
		throw new ModError(`appeal #${appeal.id} was already ${appeal.status}.`);
	}

	const ban = await guild.bans.fetch({ user: appeal.user_id }).catch(() => null);
	let decision: string;
	if (action === 'accept') {
		try {
			if (ban) {
				const reason = `Ban appeal #${appeal.id} accepted`;
				await actWithCase(
					guild,
					{
						action: 'unban',
						targetId: appeal.user_id,
						targetTag: appeal.user_tag,
						moderatorId: member.id,
						moderatorTag: member.user.username,
						reason
					},
					() => guild.members.unban(appeal.user_id, auditReason(member.user, reason))
				);
			}
			cancelScheduledAction(guild.id, 'unban', appeal.user_id);
		} catch (error) {
			reopenAppeal(guild.id, appeal.id);
			throw error;
		}
		decision = `Accepted by <@${member.id}>${ban ? ', unbanned' : ' (they were already unbanned)'}`;
	} else {
		decision = `Denied by <@${member.id}>`;
	}

	const decided = getAppeal(guild.id, appeal.id)!;
	await interaction.message
		.edit({ embeds: [appealEmbed(decided, ban?.reason ?? null, decision)], components: appealButtons(decided, true) })
		.catch(() => undefined);

	const user = await container.client.users.fetch(appeal.user_id).catch(() => null);
	const dm =
		action === 'accept'
			? `✅ Your ban appeal to **${guild.name}** was accepted. You can rejoin.`
			: `❌ Your ban appeal to **${guild.name}** was denied.`;
	const dmSent = user
		? await user.send(dm).then(
				() => true,
				() => false
			)
		: false;
	return `✅ appeal #${appeal.id}: ${decision.charAt(0).toLowerCase()}${decision.slice(1)}${dmSent ? ' · DM sent' : " · couldn't DM them"}.`;
}
