import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/voice/playback', () => ({ playAlarm: vi.fn(async () => true) }));

import { playAlarm } from '../../../src/lib/voice/playback';
import { cancel, list, MAX_PENDING_PER_USER, schedule } from '../../../src/lib/voice/timers';

const GUILD = 'guild-1';
const USER = 'user-1';
const TEXT_CHANNEL = 'text-1';

let posted: string[];
let dms: string[];
let channelSend: ReturnType<typeof vi.fn>;

function timer(overrides: Partial<Parameters<typeof schedule>[0]> = {}) {
	return schedule({
		guildId: GUILD,
		userId: USER,
		textChannelId: TEXT_CHANNEL,
		kind: 'timer',
		fireAt: Date.now() + 60_000,
		label: 'timer for 1 minute',
		...overrides
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	posted = [];
	dms = [];
	channelSend = vi.fn(async (content: string) => posted.push(content));
	(container as any).logger = { warn: vi.fn() };
	(container as any).client = {
		channels: { cache: new Map([[TEXT_CHANNEL, { isTextBased: () => true, send: channelSend }]]) },
		users: { send: vi.fn(async (_id: string, content: string) => dms.push(content)) }
	};
	vi.mocked(playAlarm).mockReset().mockResolvedValue(true);
});

afterEach(() => {
	cancel(GUILD, USER);
	vi.useRealTimers();
});

describe('timers', () => {
	it('rings with a mention in the text channel and the tone', async () => {
		timer();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(posted).toEqual([`⏰ <@${USER}> your timer for 1 minute is done.`]);
		expect(dms).toEqual([]);
		expect(playAlarm).toHaveBeenCalledWith(GUILD);
		expect(list(GUILD, USER)).toEqual([]);
	});

	it('falls back to a DM without a text channel, and when the channel send fails', async () => {
		timer({ textChannelId: null });
		channelSend.mockRejectedValueOnce(new Error('missing access'));
		timer({ fireAt: Date.now() + 120_000 });
		await vi.advanceTimersByTimeAsync(120_000);
		expect(dms).toHaveLength(2);
		expect(posted).toEqual([]);
	});

	it('retries the tone while something else is playing, then gives up', async () => {
		vi.mocked(playAlarm).mockResolvedValue(false);
		timer();
		await vi.advanceTimersByTimeAsync(60_000 + 3_000);
		expect(playAlarm).toHaveBeenCalledTimes(3);
		expect(posted).toHaveLength(1);
		expect(container.logger.warn).toHaveBeenCalledTimes(1);
	});

	it('caps how many one speaker can have going', () => {
		for (let i = 0; i < MAX_PENDING_PER_USER; i++) expect(timer()).not.toBeNull();
		expect(timer()).toBeNull();
		expect(
			schedule({ guildId: GUILD, userId: 'someone-else', textChannelId: null, kind: 'timer', fireAt: Date.now() + 1, label: 'x' })
		).not.toBeNull();
		cancel(GUILD, 'someone-else');
	});

	it('cancels by kind and lists soonest first', async () => {
		timer({ fireAt: Date.now() + 90_000, label: 'later' });
		timer({ fireAt: Date.now() + 30_000, label: 'sooner' });
		timer({ kind: 'alarm', label: 'alarm for 7:00 AM' });
		expect(list(GUILD, USER).map(({ label }) => label)).toEqual(['sooner', 'alarm for 7:00 AM', 'later']);

		expect(cancel(GUILD, USER, 'timer')).toBe(2);
		expect(list(GUILD, USER).map(({ kind }) => kind)).toEqual(['alarm']);
		await vi.advanceTimersByTimeAsync(90_000);
		expect(posted).toEqual([`⏰ <@${USER}> your alarm for 7:00 AM is done.`]);
	});
});
