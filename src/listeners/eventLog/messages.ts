import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import {
	AttachmentBuilder,
	Colors,
	EmbedBuilder,
	type GuildTextBasedChannel,
	type Message,
	type PartialMessage,
	type ReadonlyCollection,
	type Snowflake
} from 'discord.js';
import { bulkTranscript, getLogChannel, isLogDestination, isLogIgnored, quoteContent, truncate, type LogEvent } from '../../lib/eventLog';
import { postEventLog } from '../../lib/eventLogPost';

/** Should an event about a message in this channel by this author be logged at all? */
function wanted(
	event: LogEvent,
	guildId: string,
	channel: { id: string; parentId?: string | null; parent?: { parentId?: string | null } | null },
	authorId?: string | null
): boolean {
	if (!getLogChannel(guildId, event)) return false;
	if (isLogDestination(guildId, channel.id)) return false;
	// A thread's parent channel, and that channel's category, cover it too.
	return !isLogIgnored(guildId, { channelIds: [channel.id, channel.parentId, channel.parent?.parentId], userId: authorId });
}

/** How recent an edited timestamp must be to count as this update's edit when the old message isn't cached. */
const EDIT_WINDOW_MS = 60_000;

function authorLine(message: Message | PartialMessage): string {
	return message.author ? `<@${message.author.id}> (${message.author.username})` : '_unknown (not cached)_';
}

@ApplyOptions<Listener.Options>({ name: 'eventLogMessageUpdate', event: Events.MessageUpdate })
export class EventLogMessageUpdate extends Listener<typeof Events.MessageUpdate> {
	public async run(oldMessage: Message | PartialMessage, newMessage: Message) {
		// An update for an uncached message can arrive without its author (e.g. only new embeds).
		if (!newMessage.inGuild() || !newMessage.author || newMessage.author.bot || newMessage.webhookId) return;
		// Embed unfurls and pins fire updates too; only a change to the text is an edit. Without the
		// old copy, a fresh edited timestamp is the only sign the author actually edited it.
		if (oldMessage.partial) {
			if (!newMessage.editedTimestamp || Date.now() - newMessage.editedTimestamp > EDIT_WINDOW_MS) return;
		} else if (oldMessage.content === newMessage.content) return;
		if (!wanted('message_edit', newMessage.guildId, newMessage.channel, newMessage.author.id)) return;

		const embed = new EmbedBuilder()
			.setColor(Colors.Yellow)
			.setAuthor({ name: newMessage.author.username, iconURL: newMessage.author.displayAvatarURL() })
			.setDescription(`**Message edited in <#${newMessage.channelId}>** · [Jump](${newMessage.url})`)
			.addFields(
				{ name: 'Before', value: quoteContent(oldMessage.partial ? null : oldMessage.content) },
				{ name: 'After', value: quoteContent(newMessage.content) }
			)
			.setFooter({ text: `User ID: ${newMessage.author.id} · Message ID: ${newMessage.id}` })
			.setTimestamp();
		await postEventLog(newMessage.guild, 'message_edit', embed);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogMessageDelete', event: Events.MessageDelete })
export class EventLogMessageDelete extends Listener<typeof Events.MessageDelete> {
	public async run(message: Message | PartialMessage) {
		if (!message.guild || !message.guildId) return;
		if (message.author?.bot || message.webhookId) return;
		if (!wanted('message_delete', message.guildId, message.channel as GuildTextBasedChannel, message.author?.id)) return;

		const embed = new EmbedBuilder()
			.setColor(Colors.Red)
			.setDescription(`**Message deleted in <#${message.channelId}>**`)
			.addFields({ name: 'Author', value: authorLine(message), inline: true })
			.setFooter({ text: `${message.author ? `User ID: ${message.author.id} · ` : ''}Message ID: ${message.id}` })
			.setTimestamp();
		if (message.author) embed.setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() });
		if (message.createdTimestamp) {
			embed.addFields({ name: 'Sent', value: `<t:${Math.floor(message.createdTimestamp / 1000)}:R>`, inline: true });
		}
		embed.addFields({ name: 'Content', value: quoteContent(message.partial ? null : message.content) });
		if (!message.partial && message.attachments.size) {
			const names = [...message.attachments.values()].map((attachment) => attachment.name).join(', ');
			embed.addFields({ name: `Attachments (${message.attachments.size})`, value: truncate(names) });
		}
		await postEventLog(message.guild, 'message_delete', embed);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogMessageBulkDelete', event: Events.MessageBulkDelete })
export class EventLogMessageBulkDelete extends Listener<typeof Events.MessageBulkDelete> {
	public async run(messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>, channel: GuildTextBasedChannel) {
		if (!wanted('message_bulk_delete', channel.guildId, channel)) return;
		const list = [...messages.values()];
		const cached = list.filter((message) => !message.partial).length;
		const embed = new EmbedBuilder()
			.setColor(Colors.DarkRed)
			.setDescription(`**${list.length} messages bulk-deleted in <#${channel.id}>**`)
			.addFields({ name: 'Cached', value: `${cached} of ${list.length} (the transcript has their text)` })
			.setFooter({ text: `Channel ID: ${channel.id}` })
			.setTimestamp();
		const file = new AttachmentBuilder(Buffer.from(bulkTranscript(list), 'utf8'), { name: `bulk-delete-${channel.id}.txt` });
		await postEventLog(channel.guild, 'message_bulk_delete', embed, [file]);
	}
}
