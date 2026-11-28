import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import {
	ChannelType,
	Colors,
	GuildDefaultMessageNotifications,
	EmbedBuilder,
	GuildExplicitContentFilter,
	GuildMFALevel,
	GuildVerificationLevel,
	type DMChannel,
	type Guild,
	type GuildChannel,
	type GuildEmoji,
	type NonThreadGuildBasedChannel,
	type Role
} from 'discord.js';
import {
	channelMention,
	describeChanges,
	getLogChannel,
	isLogIgnored,
	permissionDiff,
	truncate,
	type FieldChange,
	type LogEvent
} from '../../lib/eventLog';
import { postEventLog } from '../../lib/eventLogPost';

function changeEmbed(color: number, title: string, lines: string[], footer: string): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(color)
		.setDescription(truncate([`**${title}**`, ...lines].join('\n'), 4096))
		.setFooter({ text: footer })
		.setTimestamp();
}

async function post(guild: Guild, event: LogEvent, embed: EmbedBuilder): Promise<void> {
	if (!getLogChannel(guild.id, event)) return;
	await postEventLog(guild, event, embed);
}

// ---------------------------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------------------------

function channelKind(channel: GuildChannel): string {
	return ChannelType[channel.type]?.replace(/^Guild/, '') ?? 'channel';
}

function channelIgnored(channel: GuildChannel): boolean {
	return isLogIgnored(channel.guild.id, { channelIds: [channel.id, channel.parentId] });
}

/** Overwrites as `target:allow:deny`, so any change to them shows up as a difference. */
function overwriteKey(channel: GuildChannel): string {
	return [...channel.permissionOverwrites.cache.values()]
		.map((overwrite) => `${overwrite.id}:${overwrite.allow.bitfield}:${overwrite.deny.bitfield}`)
		.sort()
		.join('|');
}

function channelChanges(before: GuildChannel, after: GuildChannel): string[] {
	const read = (channel: GuildChannel, key: string) => (channel as unknown as Record<string, unknown>)[key] ?? null;
	const fields: FieldChange[] = [
		{ name: 'Name', before: before.name, after: after.name },
		{ name: 'Category', before: before.parentId, after: after.parentId, format: channelMention },
		{
			name: 'Topic',
			before: read(before, 'topic'),
			after: read(after, 'topic'),
			format: (value) => (value ? truncate(String(value), 300) : '_none_')
		},
		{ name: 'NSFW', before: read(before, 'nsfw'), after: read(after, 'nsfw') },
		{ name: 'Slowmode (s)', before: read(before, 'rateLimitPerUser'), after: read(after, 'rateLimitPerUser') },
		{ name: 'Bitrate', before: read(before, 'bitrate'), after: read(after, 'bitrate') },
		{ name: 'User limit', before: read(before, 'userLimit'), after: read(after, 'userLimit') }
	];
	const lines = describeChanges(fields);
	if (overwriteKey(before) !== overwriteKey(after)) lines.push('**Permission overwrites** changed');
	return lines;
}

@ApplyOptions<Listener.Options>({ name: 'eventLogChannelCreate', event: Events.ChannelCreate })
export class EventLogChannelCreate extends Listener<typeof Events.ChannelCreate> {
	public async run(channel: NonThreadGuildBasedChannel) {
		if (channelIgnored(channel)) return;
		const lines = [`<#${channel.id}> (${channel.name}, ${channelKind(channel)})`];
		if (channel.parentId) lines.push(`**Category:** <#${channel.parentId}>`);
		await post(channel.guild, 'channel_changes', changeEmbed(Colors.Green, 'Channel created', lines, `Channel ID: ${channel.id}`));
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogChannelDelete', event: Events.ChannelDelete })
export class EventLogChannelDelete extends Listener<typeof Events.ChannelDelete> {
	public async run(channel: DMChannel | NonThreadGuildBasedChannel) {
		if (channel.isDMBased() || channelIgnored(channel)) return;
		const lines = [`#${channel.name} (${channelKind(channel)})`];
		if (channel.parentId) lines.push(`**Category:** <#${channel.parentId}>`);
		await post(channel.guild, 'channel_changes', changeEmbed(Colors.Red, 'Channel deleted', lines, `Channel ID: ${channel.id}`));
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogChannelUpdate', event: Events.ChannelUpdate })
export class EventLogChannelUpdate extends Listener<typeof Events.ChannelUpdate> {
	public async run(oldChannel: DMChannel | NonThreadGuildBasedChannel, newChannel: DMChannel | NonThreadGuildBasedChannel) {
		if (oldChannel.isDMBased() || newChannel.isDMBased() || channelIgnored(newChannel)) return;
		// Reordering channels fires an update for each one moved; position alone isn't worth a log line.
		const lines = channelChanges(oldChannel, newChannel);
		if (!lines.length) return;
		await post(
			newChannel.guild,
			'channel_changes',
			changeEmbed(Colors.Blue, `Channel updated: <#${newChannel.id}>`, lines, `Channel ID: ${newChannel.id}`)
		);
	}
}

// ---------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------

function roleChanges(before: Role, after: Role): string[] {
	const lines = describeChanges([
		{ name: 'Name', before: before.name, after: after.name },
		{ name: 'Colour', before: before.hexColor, after: after.hexColor },
		{ name: 'Shown separately', before: before.hoist, after: after.hoist },
		{ name: 'Mentionable', before: before.mentionable, after: after.mentionable },
		{ name: 'Icon', before: before.icon ?? before.unicodeEmoji, after: after.icon ?? after.unicodeEmoji }
	]);
	const permissions = permissionDiff(before.permissions, after.permissions);
	if (permissions.added.length) lines.push(`**Permissions granted:** ${permissions.added.join(', ')}`);
	if (permissions.removed.length) lines.push(`**Permissions revoked:** ${permissions.removed.join(', ')}`);
	return lines;
}

@ApplyOptions<Listener.Options>({ name: 'eventLogRoleCreate', event: Events.GuildRoleCreate })
export class EventLogRoleCreate extends Listener<typeof Events.GuildRoleCreate> {
	public async run(role: Role) {
		const lines = [`<@&${role.id}> (${role.name})`];
		if (role.managed) lines.push('Managed by an integration');
		await post(role.guild, 'role_changes', changeEmbed(Colors.Green, 'Role created', lines, `Role ID: ${role.id}`));
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogRoleDelete', event: Events.GuildRoleDelete })
export class EventLogRoleDelete extends Listener<typeof Events.GuildRoleDelete> {
	public async run(role: Role) {
		await post(role.guild, 'role_changes', changeEmbed(Colors.Red, 'Role deleted', [`@${role.name} (${role.hexColor})`], `Role ID: ${role.id}`));
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogRoleUpdate', event: Events.GuildRoleUpdate })
export class EventLogRoleUpdate extends Listener<typeof Events.GuildRoleUpdate> {
	public async run(oldRole: Role, newRole: Role) {
		// Dragging one role shifts the position of every role below it; skip position-only updates.
		const lines = roleChanges(oldRole, newRole);
		if (!lines.length) return;
		await post(newRole.guild, 'role_changes', changeEmbed(Colors.Blue, `Role updated: <@&${newRole.id}>`, lines, `Role ID: ${newRole.id}`));
	}
}

// ---------------------------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------------------------

@ApplyOptions<Listener.Options>({ name: 'eventLogEmojiCreate', event: Events.GuildEmojiCreate })
export class EventLogEmojiCreate extends Listener<typeof Events.GuildEmojiCreate> {
	public async run(emoji: GuildEmoji) {
		const embed = changeEmbed(Colors.Green, 'Emoji added', [`${emoji} \`:${emoji.name}:\``], `Emoji ID: ${emoji.id}`).setThumbnail(
			emoji.imageURL()
		);
		await post(emoji.guild, 'emoji_changes', embed);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogEmojiDelete', event: Events.GuildEmojiDelete })
export class EventLogEmojiDelete extends Listener<typeof Events.GuildEmojiDelete> {
	public async run(emoji: GuildEmoji) {
		const embed = changeEmbed(Colors.Red, 'Emoji removed', [`\`:${emoji.name}:\``], `Emoji ID: ${emoji.id}`).setThumbnail(emoji.imageURL());
		await post(emoji.guild, 'emoji_changes', embed);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogEmojiUpdate', event: Events.GuildEmojiUpdate })
export class EventLogEmojiUpdate extends Listener<typeof Events.GuildEmojiUpdate> {
	public async run(oldEmoji: GuildEmoji, newEmoji: GuildEmoji) {
		const lines = describeChanges([{ name: 'Name', before: oldEmoji.name, after: newEmoji.name }]);
		if (!lines.length) return;
		await post(newEmoji.guild, 'emoji_changes', changeEmbed(Colors.Blue, `Emoji updated: ${newEmoji}`, lines, `Emoji ID: ${newEmoji.id}`));
	}
}

// ---------------------------------------------------------------------------------------------
// Server settings
// ---------------------------------------------------------------------------------------------

function enumName(names: Record<number, string>) {
	return (value: unknown) => (typeof value === 'number' ? (names[value] ?? String(value)) : '_none_');
}

function guildChanges(before: Guild, after: Guild): string[] {
	return describeChanges([
		{ name: 'Name', before: before.name, after: after.name },
		{ name: 'Description', before: before.description, after: after.description },
		{ name: 'Icon', before: before.icon, after: after.icon, format: (value) => (value ? 'set' : '_none_') },
		{ name: 'Banner', before: before.banner, after: after.banner, format: (value) => (value ? 'set' : '_none_') },
		{ name: 'Owner', before: before.ownerId, after: after.ownerId, format: (value) => `<@${String(value)}>` },
		{ name: 'Verification level', before: before.verificationLevel, after: after.verificationLevel, format: enumName(GuildVerificationLevel) },
		{
			name: 'Explicit content filter',
			before: before.explicitContentFilter,
			after: after.explicitContentFilter,
			format: enumName(GuildExplicitContentFilter)
		},
		{
			name: 'Default notifications',
			before: before.defaultMessageNotifications,
			after: after.defaultMessageNotifications,
			format: enumName(GuildDefaultMessageNotifications)
		},
		{ name: '2FA for moderation', before: before.mfaLevel, after: after.mfaLevel, format: enumName(GuildMFALevel) },
		{ name: 'AFK channel', before: before.afkChannelId, after: after.afkChannelId, format: channelMention },
		{ name: 'AFK timeout (s)', before: before.afkTimeout, after: after.afkTimeout },
		{ name: 'System channel', before: before.systemChannelId, after: after.systemChannelId, format: channelMention },
		{ name: 'Rules channel', before: before.rulesChannelId, after: after.rulesChannelId, format: channelMention },
		{ name: 'Vanity URL', before: before.vanityURLCode, after: after.vanityURLCode },
		{ name: 'Language', before: before.preferredLocale, after: after.preferredLocale },
		{ name: 'Boost progress bar', before: before.premiumProgressBarEnabled, after: after.premiumProgressBarEnabled }
	]);
}

@ApplyOptions<Listener.Options>({ name: 'eventLogGuildUpdate', event: Events.GuildUpdate })
export class EventLogGuildUpdate extends Listener<typeof Events.GuildUpdate> {
	public async run(oldGuild: Guild, newGuild: Guild) {
		const lines = guildChanges(oldGuild, newGuild);
		if (!lines.length) return;
		await post(newGuild, 'server_changes', changeEmbed(Colors.Blurple, 'Server settings changed', lines, `Server ID: ${newGuild.id}`));
	}
}
