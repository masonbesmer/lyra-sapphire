import { describe, expect, it } from 'vitest';
import { buildIdlePayload, buildPlayerPayload, PLAYER_MESSAGE_FLAGS, type PlayerPayload } from '../../src/lib/playerComponents';

function customIds(payload: PlayerPayload): string[] {
	const ids: string[] = [];
	const walk = (node: unknown) => {
		if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === 'object') {
			const record = node as Record<string, unknown>;
			if (typeof record.custom_id === 'string') ids.push(record.custom_id);
			Object.values(record).forEach(walk);
		}
	};
	walk(payload.components.map((component) => component.toJSON()));
	return ids;
}

function fakePlayer(current: unknown) {
	const queue = Object.assign([{ title: 'Up Next' }], { current, previous: [], size: 1 });
	return { data: new Map(), queue, paused: false, volume: 80, loop: 'none', position: 30_000 } as never;
}

const TRACK = { title: 'Song', uri: 'https://x/y', thumbnail: 'https://x/t.png', length: 120_000, author: 'Artist', requester: { id: '1' } };

describe('buildIdlePayload', () => {
	it('offers autoplay, restart and disconnect', () => {
		const payload = buildIdlePayload();
		expect(payload.flags).toBe(PLAYER_MESSAGE_FLAGS);
		expect(customIds(payload)).toEqual(['player_autoplay_start', 'player_restart_queue', 'player_stop']);
	});
});

describe('buildPlayerPayload', () => {
	it('sends bare control rows when nothing is playing', () => {
		const payload = buildPlayerPayload(fakePlayer(undefined));
		expect(payload.flags).toBe(PLAYER_MESSAGE_FLAGS);
		expect(payload.components).toHaveLength(2);
		expect(customIds(payload)).toContain('player_pause');
	});

	it('sends bare control rows when announce is off', () => {
		const payload = buildPlayerPayload(fakePlayer(TRACK), { announce: false });
		expect(payload.flags).toBe(PLAYER_MESSAGE_FLAGS);
		expect(payload.components).toHaveLength(2);
	});

	it('renders the now-playing card with every control', () => {
		const payload = buildPlayerPayload(fakePlayer(TRACK));
		expect(payload.flags).toBe(PLAYER_MESSAGE_FLAGS);
		expect(payload.components).toHaveLength(1);
		expect(customIds(payload)).toEqual([
			'player_shuffle',
			'player_previous',
			'player_pause',
			'player_skip',
			'player_queue',
			'player_options',
			'player_lyrics',
			'player_filters',
			'player_stop'
		]);
		const text = JSON.stringify(payload.components[0].toJSON());
		expect(text).toContain('[Song](https://x/y)');
		expect(text).toContain('Up next: Up Next');
		expect(text).toContain('0:30 / 2:00');
	});
});
