import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { sendVoiceState } from '../lib/websocket';

/**
 * Keeps the dashboard's inferred voice channel in sync: the web UI targets whichever channel
 * the viewer is sitting in, and hides the player entirely once they leave.
 */
@ApplyOptions<Listener.Options>({
	event: Events.VoiceStateUpdate
})
export class WsVoiceStateListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override run(oldState: VoiceState, newState: VoiceState): void {
		const member = newState.member ?? oldState.member;
		if (!member || member.user.bot) return;
		if (oldState.channelId === newState.channelId) return;

		// `member.voice` reads the guild's voice-state cache, which discord.js has already
		// patched with newState by the time this fires - so it can't go stale here.
		sendVoiceState(newState.guild.id, member.id, member);
	}
}
