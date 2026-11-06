import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPrecondition } from '../../src/preconditions/OwnerOnly';
import { buildPrecondition, settled } from '../helpers/discord';

const MESSAGE = "that one's for the owner only, nice try.";
const precondition = buildPrecondition(UserPrecondition, 'OwnerOnly');

beforeEach(() => {
	vi.stubEnv('OWNERS', 'owner-1 owner-2');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('OwnerOnly', () => {
	it('allows an owner on every flow', () => {
		expect(settled(precondition.messageRun({ author: { id: 'owner-2' } } as never)).isOk()).toBe(true);
		expect(settled(precondition.chatInputRun({ user: { id: 'owner-1' } } as never)).isOk()).toBe(true);
		expect(settled(precondition.contextMenuRun({ user: { id: 'owner-1' } } as never)).isOk()).toBe(true);
	});

	it('refuses everyone else with its message', () => {
		const result = settled(precondition.chatInputRun({ user: { id: 'stranger' } } as never));
		expect(result.isErr()).toBe(true);
		expect(result.unwrapErr().message).toBe(MESSAGE);
		expect(settled(precondition.messageRun({ author: { id: 'stranger' } } as never)).isErr()).toBe(true);
	});
});
