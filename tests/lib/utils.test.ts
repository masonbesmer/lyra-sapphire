import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSuccessLoggerData, pickRandom } from '../../src/lib/utils';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('pickRandom', () => {
	it('indexes the array by Math.random', () => {
		const random = vi.spyOn(Math, 'random').mockReturnValue(0);
		expect(pickRandom(['a', 'b', 'c'])).toBe('a');
		random.mockReturnValue(0.99);
		expect(pickRandom(['a', 'b', 'c'])).toBe('c');
	});
});

describe('getSuccessLoggerData', () => {
	const user = { username: 'alice', id: '42' } as never;
	const command = { name: 'ping' } as never;

	it('reports Direct Messages and shard 0 without a guild', () => {
		const data = getSuccessLoggerData(null, user, command);
		expect(data.sentAt).toBe('Direct Messages');
		expect(data.shard).toContain('0');
		expect(data.commandName).toContain('ping');
		expect(data.author).toMatch(/^alice\[.*42.*\]$/);
	});

	it('reports the guild name, id and shard', () => {
		const data = getSuccessLoggerData({ name: 'Crew', id: '7', shardId: 3 } as never, user, command);
		expect(data.sentAt).toMatch(/^Crew\[.*7.*\]$/);
		expect(data.shard).toContain('3');
	});
});
