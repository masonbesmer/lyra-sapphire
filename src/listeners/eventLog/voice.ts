import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import { Colors, EmbedBuilder, type VoiceState } from 'discord.js';
import { getLogChannel, isLogIgnored, voiceEvent } from '../../lib/eventLog';
import { postEventLog } from '../../lib/eventLogPost';

const COLORS: Record<string, number> = { voice_join: Colors.Green, voice_leave: Colors.Orange, voice_move: Colors.Blue };

@ApplyOptions<Listener.Options>({ name: 'eventLogVoiceState', event: Events.VoiceStateUpdate })
export class EventLogVoiceState extends Listener<typeof Events.VoiceStateUpdate> {
	public async run(oldState: VoiceState, newState: VoiceState) {
		const event = voiceEvent(oldState.channelId, newState.channelId);
		if (!event) return;
		const guild = newState.guild;
		const member = newState.member ?? oldState.member;
		// Music bots (Lyra included) hop in and out all the time; that's noise, not a log entry.
		if (!member || member.user.bot) return;
		if (!getLogChannel(guild.id, event)) return;
		const channelIds = [oldState.channelId, newState.channelId, oldState.channel?.parentId, newState.channel?.parentId];
		if (isLogIgnored(guild.id, { channelIds, userId: member.id })) return;

		const line =
			event === 'voice_join'
				? `joined <#${newState.channelId}>`
				: event === 'voice_leave'
					? `left <#${oldState.channelId}>`
					: `moved <#${oldState.channelId}> → <#${newState.channelId}>`;
		const embed = new EmbedBuilder()
			.setColor(COLORS[event])
			.setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL() })
			.setDescription(`<@${member.id}> ${line}`)
			.setFooter({ text: `User ID: ${member.id}` })
			.setTimestamp();
		await postEventLog(guild, event, embed);
	}
}
