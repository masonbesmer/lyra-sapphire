import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMusicConfig } from '../../src/lib/config';
import { cancelIdleLeave, scheduleIdleLeave } from '../../src/lib/musicIdle';

const logger = { error: vi.fn(), info: vi.fn() };

function fakePlayer(guildId: string, state: { playing?: boolean; paused?: boolean; current?: unknown; size?: number } = {}) {
	return {
		guildId,
		playing: state.playing ?? false,
		paused: state.paused ?? false,
		queue: { current: state.current ?? null, size: state.size ?? 0 },
		destroy: vi.fn(async () => {})
	};
}

function install(player: ReturnType<typeof fakePlayer> | undefined) {
	(container as any).client = { kazagumo: { getPlayer: () => player } };
}

beforeEach(() => {
	vi.useFakeTimers();
	(container as any).logger = logger;
	logger.error.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('scheduleIdleLeave', () => {
	it('disconnects an idle player after the configured timeout', async () => {
		setMusicConfig({ guild_id: 'idle-fire', idle_timeout_ms: 1000 });
		const player = fakePlayer('idle-fire');
		install(player);
		scheduleIdleLeave(player as never);
		await vi.advanceTimersByTimeAsync(999);
		expect(player.destroy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(player.destroy).toHaveBeenCalledTimes(1);
	});

	it('uses the default timeout for an unconfigured guild', async () => {
		const player = fakePlayer('idle-default');
		install(player);
		scheduleIdleLeave(player as never);
		await vi.advanceTimersByTimeAsync(300_000);
		expect(player.destroy).toHaveBeenCalledTimes(1);
	});

	it('arms nothing when the timeout is 0', () => {
		setMusicConfig({ guild_id: 'idle-off', idle_timeout_ms: 0 });
		scheduleIdleLeave(fakePlayer('idle-off') as never);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('re-arms instead of stacking timers', async () => {
		setMusicConfig({ guild_id: 'idle-rearm', idle_timeout_ms: 1000 });
		const player = fakePlayer('idle-rearm');
		install(player);
		scheduleIdleLeave(player as never);
		await vi.advanceTimersByTimeAsync(600);
		scheduleIdleLeave(player as never);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(600);
		expect(player.destroy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(400);
		expect(player.destroy).toHaveBeenCalledTimes(1);
	});

	it.each([{ playing: true }, { paused: true }, { current: {} }, { size: 1 }])('stays when the player is no longer idle: %o', async (state) => {
		const guildId = `idle-busy-${Object.keys(state)[0]}`;
		setMusicConfig({ guild_id: guildId, idle_timeout_ms: 10 });
		const player = fakePlayer(guildId, state);
		install(player);
		scheduleIdleLeave(player as never);
		await vi.advanceTimersByTimeAsync(10);
		expect(player.destroy).not.toHaveBeenCalled();
	});

	it('does nothing when the player is already gone', async () => {
		setMusicConfig({ guild_id: 'idle-gone', idle_timeout_ms: 10 });
		install(undefined);
		scheduleIdleLeave(fakePlayer('idle-gone') as never);
		await expect(vi.advanceTimersByTimeAsync(10)).resolves.toBeDefined();
	});

	it('logs a failed disconnect instead of throwing', async () => {
		setMusicConfig({ guild_id: 'idle-fail', idle_timeout_ms: 10 });
		const player = fakePlayer('idle-fail');
		player.destroy.mockRejectedValueOnce(new Error('ws closed'));
		install(player);
		scheduleIdleLeave(player as never);
		await vi.advanceTimersByTimeAsync(10);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ws closed'));
	});
});

describe('cancelIdleLeave', () => {
	it('prevents the disconnect', async () => {
		setMusicConfig({ guild_id: 'idle-cancel', idle_timeout_ms: 10 });
		const player = fakePlayer('idle-cancel');
		install(player);
		scheduleIdleLeave(player as never);
		cancelIdleLeave('idle-cancel');
		await vi.advanceTimersByTimeAsync(10);
		expect(player.destroy).not.toHaveBeenCalled();
	});

	it('is a no-op for a guild with nothing pending', () => {
		expect(() => cancelIdleLeave('idle-none')).not.toThrow();
	});
});
