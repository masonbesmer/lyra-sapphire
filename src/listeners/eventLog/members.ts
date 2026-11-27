import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import { Colors, EmbedBuilder, type GuildMember, type PartialGuildMember, type PartialUser, type User } from 'discord.js';
import { accountAgeLine, diffIds, getLogChannel, isLogIgnored, truncate, type LogEvent } from '../../lib/eventLog';
import { postEventLog, resolveJoinInvite } from '../../lib/eventLogPost';

function wanted(event: LogEvent, guildId: string, userId: string): boolean {
	return getLogChannel(guildId, event) !== null && !isLogIgnored(guildId, { userId });
}

function memberEmbed(user: User, color: number, title: string): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(color)
		.setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
		.setDescription(`**${title}:** <@${user.id}> (${user.username})`)
		.setFooter({ text: `User ID: ${user.id}` })
		.setTimestamp();
}

@ApplyOptions<Listener.Options>({ name: 'eventLogMemberAdd', event: Events.GuildMemberAdd })
export class EventLogMemberAdd extends Listener<typeof Events.GuildMemberAdd> {
	public async run(member: GuildMember) {
		if (!getLogChannel(member.guild.id, 'member_join')) return;
		// Refresh the invite snapshot even for ignored users, so the next join is attributed right.
		const invite = await resolveJoinInvite(member.guild);
		if (isLogIgnored(member.guild.id, { userId: member.id })) return;
		const embed = memberEmbed(member.user, Colors.Green, member.user.bot ? 'Bot added' : 'Member joined')
			.setThumbnail(member.user.displayAvatarURL())
			.addFields(
				{ name: 'Account created', value: accountAgeLine(member.user.createdTimestamp), inline: true },
				{ name: 'Member count', value: String(member.guild.memberCount), inline: true }
			);
		let inviteLine = '_unknown_';
		if (invite.kind === 'invite') {
			const by = invite.invite.inviterId ? ` by <@${invite.invite.inviterId}>` : '';
			inviteLine = `\`${invite.invite.code}\`${by} (${invite.invite.uses} uses)`;
		} else if (invite.kind === 'vanity') {
			inviteLine = `probably the vanity URL \`${invite.code}\``;
		}
		embed.addFields({ name: 'Invite', value: inviteLine });
		await postEventLog(member.guild, 'member_join', embed);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogMemberRemove', event: Events.GuildMemberRemove })
export class EventLogMemberRemove extends Listener<typeof Events.GuildMemberRemove> {
	public async run(member: GuildMember | PartialGuildMember) {
		if (!wanted('member_leave', member.guild.id, member.id)) return;
		const embed = memberEmbed(member.user, Colors.Orange, member.user.bot ? 'Bot removed' : 'Member left').addFields(
			{ name: 'Account created', value: accountAgeLine(member.user.createdTimestamp), inline: true },
			{ name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '_unknown_', inline: true }
		);
		if (!member.partial) {
			const roles = member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => `<@&${role.id}>`);
			if (roles.length) embed.addFields({ name: `Roles (${roles.length})`, value: truncate(roles.join(' ')) });
		}
		await postEventLog(member.guild, 'member_leave', embed);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogMemberUpdate', event: Events.GuildMemberUpdate })
export class EventLogMemberUpdate extends Listener<typeof Events.GuildMemberUpdate> {
	public async run(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
		// Without the old state there's nothing to compare against.
		if (oldMember.partial) return;
		const guild = newMember.guild;
		const user = newMember.user;

		if (oldMember.nickname !== newMember.nickname && wanted('member_nick', guild.id, user.id)) {
			const embed = memberEmbed(user, Colors.Blue, 'Nickname changed').addFields(
				{ name: 'Before', value: oldMember.nickname ? truncate(oldMember.nickname) : '_none_', inline: true },
				{ name: 'After', value: newMember.nickname ? truncate(newMember.nickname) : '_none_', inline: true }
			);
			await postEventLog(guild, 'member_nick', embed);
		}

		const roles = diffIds(oldMember.roles.cache.keys(), newMember.roles.cache.keys());
		if ((roles.added.length || roles.removed.length) && wanted('member_roles', guild.id, user.id)) {
			const embed = memberEmbed(user, Colors.Blue, 'Roles changed');
			if (roles.added.length) embed.addFields({ name: 'Added', value: truncate(roles.added.map((id) => `<@&${id}>`).join(' ')) });
			if (roles.removed.length) embed.addFields({ name: 'Removed', value: truncate(roles.removed.map((id) => `<@&${id}>`).join(' ')) });
			await postEventLog(guild, 'member_roles', embed);
		}

		if (oldMember.avatar !== newMember.avatar && wanted('member_avatar', guild.id, user.id)) {
			const embed = memberEmbed(user, Colors.Blue, 'Server avatar changed');
			const url = newMember.avatarURL();
			if (url) embed.setThumbnail(url);
			embed.addFields({ name: 'Now', value: url ? `[New avatar](${url})` : '_removed (back to their profile avatar)_' });
			await postEventLog(guild, 'member_avatar', embed);
		}
	}
}

/** A profile avatar change is global, so it's logged in every server that shares the member. */
@ApplyOptions<Listener.Options>({ name: 'eventLogUserUpdate', event: Events.UserUpdate })
export class EventLogUserUpdate extends Listener<typeof Events.UserUpdate> {
	public async run(oldUser: User | PartialUser, newUser: User) {
		if (oldUser.partial || oldUser.avatar === newUser.avatar) return;
		for (const guild of this.container.client.guilds.cache.values()) {
			if (!guild.members.cache.has(newUser.id) || !wanted('member_avatar', guild.id, newUser.id)) continue;
			const embed = memberEmbed(newUser, Colors.Blue, 'Profile avatar changed')
				.setThumbnail(newUser.displayAvatarURL())
				.addFields({ name: 'Now', value: `[New avatar](${newUser.displayAvatarURL({ size: 1024 })})` });
			await postEventLog(guild, 'member_avatar', embed);
		}
	}
}
