import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/voice/musicClient', () => ({ getMusicBotChannelId: vi.fn(() => null) }));

import { getMusicBotChannelId } from '../../src/lib/voice/musicClient';
import { UserPrecondition } from '../../src/preconditions/InVoiceWithBot';
import { buildPrecondition, settled, guildMember } from '../helpers/discord';

const NO_VOICE = "hey dumbass, you aren't in a voice channel.";
const WRONG_CHANNEL = 'get in my voice channel if you want to control the player.';
const precondition = buildPrecondition(UserPrecondition, 'InVoiceWithBot');

function member(channelId: string | null) {
	return guildMember({ guild: { id: 'voice-guild' }, voice: { channel: channelId ? { id: channelId } : null } });
}

function interaction(channelId: string | null, cached = true) {
	return { inCachedGuild: () => cached, member: member(channelId) } as never;
}

function errorMessage(result: ReturnType<typeof settled>) {
	return result.isErr() ? result.unwrapErr().message : null;
}

beforeEach(() => {
	vi.mocked(getMusicBotChannelId).mockReturnValue(null);
});

describe('InVoiceWithBot', () => {
	it('refuses a member who is not in voice', () => {
		expect(errorMessage(settled(precondition.chatInputRun(interaction(null))))).toBe(NO_VOICE);
		expect(errorMessage(settled(precondition.messageRun({ member: member(null) } as never)))).toBe(NO_VOICE);
	});

	it('refuses outside a cached guild or without a guild member', () => {
		expect(errorMessage(settled(precondition.contextMenuRun(interaction('v1', false))))).toBe(NO_VOICE);
		expect(errorMessage(settled(precondition.messageRun({ member: null } as never)))).toBe(NO_VOICE);
	});

	it('allows any voice channel when the music bot is not in voice', () => {
		expect(settled(precondition.chatInputRun(interaction('v1'))).isOk()).toBe(true);
	});

	it('requires the music bot channel when it is in voice', () => {
		vi.mocked(getMusicBotChannelId).mockReturnValue('v2');
		expect(errorMessage(settled(precondition.chatInputRun(interaction('v1'))))).toBe(WRONG_CHANNEL);
		expect(settled(precondition.chatInputRun(interaction('v2'))).isOk()).toBe(true);
		expect(settled(precondition.messageRun({ member: member('v2') } as never)).isOk()).toBe(true);
		expect(getMusicBotChannelId).toHaveBeenCalledWith('voice-guild');
	});
});
