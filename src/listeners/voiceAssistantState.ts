import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { isAssistantActive, stopAssistantSession } from '../lib/voice/session';

@ApplyOptions<Listener.Options>({
	event: Events.VoiceStateUpdate
})
export class VoiceAssistantStateListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override async run(oldState: VoiceState, newState: VoiceState): Promise<void> {
		const guildId = (newState.guild ?? oldState.guild).id;
		if (!isAssistantActive(guildId)) return;

		// Only a departure can empty a channel. Joins are handled by the audio source, which
		// picks up new speakers itself.
		if (!oldState.channelId || oldState.channelId === newState.channelId) return;

		const channel = oldState.channel;
		if (!channel) return;

		const humans = channel.members.filter((member) => !member.user.bot).size;
		if (humans > 0) return;

		// Nobody left to listen to. Keeping the session open would hold a receive connection
		// open on an empty channel indefinitely, which is both wasteful and, for an
		// always-on listener, poor manners.
		this.container.logger.info(`[voice/session] ${guildId}: voice channel empty, stopping assistant`);
		await stopAssistantSession(guildId);
	}
}
