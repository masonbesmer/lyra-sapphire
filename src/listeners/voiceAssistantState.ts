import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { cancelFollowJoin, scheduleFollowJoin } from '../lib/voice/follow';
import { getAssistantChannelId, stopAssistantSession } from '../lib/voice/session';

@ApplyOptions<Listener.Options>({
	event: Events.VoiceStateUpdate
})
export class VoiceAssistantStateListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override async run(oldState: VoiceState, newState: VoiceState): Promise<void> {
		// Mute, deafen and stream toggles fire this too, and none of them move anybody.
		if (oldState.channelId === newState.channelId) return;

		const guildId = (newState.guild ?? oldState.guild).id;
		const member = newState.member ?? oldState.member;

		if (member && !member.user.bot) {
			// A pending follow is for the channel the member was heading into, so leaving that
			// channel — or hopping to another — retires it. Joining re-arms it.
			if (oldState.channelId) cancelFollowJoin(guildId, member.id);
			if (newState.channel) scheduleFollowJoin(newState.channel, member.id);
		}

		// Only a departure can empty a channel, and only the channel Lyra is actually sitting
		// in is hers to leave.
		if (!oldState.channelId || oldState.channelId !== getAssistantChannelId(guildId)) return;

		const channel = oldState.channel;
		if (!channel) return;

		const humans = channel.members.filter((entry) => !entry.user.bot).size;
		if (humans > 0) return;

		// Nobody left to listen to. Keeping the session open would hold a receive connection
		// open on an empty channel indefinitely, which is both wasteful and, for an
		// always-on listener, poor manners. Note that this fires on the *last* person leaving,
		// not on a follower leaving: whoever brought her in can go without ending it for
		// everyone else.
		this.container.logger.info(`[voice/session] ${guildId}: voice channel empty, stopping assistant`);
		await stopAssistantSession(guildId);
	}
}
