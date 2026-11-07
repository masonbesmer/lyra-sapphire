import { container } from '@sapphire/framework';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryAutoplay } from '../../src/lib/musicAutoplay';

const search = vi.fn();
const logger = { error: vi.fn() };

function fakePlayer(previous: { title: string; author?: string; uri?: string; requester?: unknown }[]) {
	return { guildId: 'ap', queue: { previous, add: vi.fn() }, play: vi.fn(async () => {}) };
}

beforeEach(() => {
	search.mockReset();
	logger.error.mockClear();
	(container as any).client = { kazagumo: { search } };
	(container as any).logger = logger;
});

describe('tryAutoplay', () => {
	it('returns false with no previous track', async () => {
		expect(await tryAutoplay(fakePlayer([]) as never)).toBe(false);
		expect(search).not.toHaveBeenCalled();
	});

	it('seeds from the author, falling back to the title', async () => {
		search.mockResolvedValue({ tracks: [] });
		await tryAutoplay(fakePlayer([{ title: 'Song', author: 'Artist', requester: 'r' }]) as never);
		expect(search).toHaveBeenCalledWith('Artist', { requester: 'r', engine: 'youtube' });
		await tryAutoplay(fakePlayer([{ title: 'Song' }]) as never);
		expect(search).toHaveBeenCalledWith('Song', expect.anything());
	});

	it('skips tracks already in recent history and plays the first fresh one', async () => {
		const player = fakePlayer([
			{ title: 'Last', author: 'Artist', uri: 'https://x/last' },
			{ title: 'Older', uri: 'https://x/older' }
		]);
		const fresh = { title: 'Fresh', uri: 'https://x/fresh' };
		search.mockResolvedValue({ tracks: [{ uri: 'https://x/last' }, { uri: 'https://x/older' }, fresh, { uri: 'https://x/later' }] });
		expect(await tryAutoplay(player as never)).toBe(true);
		expect(player.queue.add).toHaveBeenCalledWith(fresh);
		expect(player.play).toHaveBeenCalled();
	});

	it('accepts a track without a uri', async () => {
		const player = fakePlayer([{ title: 'Last', uri: 'https://x/last' }]);
		const noUri = { title: 'No uri' };
		search.mockResolvedValue({ tracks: [{ uri: 'https://x/last' }, noUri] });
		expect(await tryAutoplay(player as never)).toBe(true);
		expect(player.queue.add).toHaveBeenCalledWith(noUri);
	});

	it('returns false when every result was already played', async () => {
		const player = fakePlayer([{ title: 'Last', uri: 'https://x/last' }]);
		search.mockResolvedValue({ tracks: [{ uri: 'https://x/last' }] });
		expect(await tryAutoplay(player as never)).toBe(false);
		expect(player.play).not.toHaveBeenCalled();
	});

	it('returns false and logs when the search throws', async () => {
		search.mockRejectedValue(new Error('lavalink down'));
		expect(await tryAutoplay(fakePlayer([{ title: 'Last' }]) as never)).toBe(false);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('lavalink down'));
	});
});
