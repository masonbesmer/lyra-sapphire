import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { VoiceState } from 'discord.js';
import { voiceSessions, recordVoiceSession } from '../lib/leaderboard';

@ApplyOptions<Listener.Options>({
	event: Events.VoiceStateUpdate
})
export class LeaderboardVoiceListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override run(oldState: VoiceState, newState: VoiceState): void {
		const member = newState.member ?? oldState.member;
		if (!member || member.user.bot) return;

		const guildId = newState.guild.id;
		const userId = member.id;
		const key = `${userId}:${guildId}`;
		const now = Date.now();

		const joined = oldState.channelId === null && newState.channelId !== null;
		const left = oldState.channelId !== null && newState.channelId === null;
		const switched = oldState.channelId !== null && newState.channelId !== null && oldState.channelId !== newState.channelId;

		if (joined) {
			voiceSessions.set(key, now);
			return;
		}

		if (left || switched) {
			const joinTime = voiceSessions.get(key);
			if (joinTime !== undefined) {
				const durationS = Math.floor((now - joinTime) / 1000);
				if (durationS > 0) recordVoiceSession(guildId, userId, durationS);
				voiceSessions.delete(key);
			}
			if (switched) {
				voiceSessions.set(key, now);
			}
		}
	}
}
