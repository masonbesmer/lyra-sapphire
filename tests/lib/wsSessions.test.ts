import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/database';
import { cleanupExpiredSessions, recordSession, removeSession } from '../../src/lib/wsSessions';

function session(sessionId: string) {
	return db.prepare('SELECT user_id, guild_id, expires_at FROM active_sessions WHERE session_id = ?').all(sessionId);
}

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

describe('wsSessions', () => {
	it('upserts a session that re-subscribes to another guild', () => {
		recordSession('ws-upsert', 'u1', 'g1', FUTURE);
		recordSession('ws-upsert', 'u1', 'g2', FUTURE);
		expect(session('ws-upsert')).toEqual([{ user_id: 'u1', guild_id: 'g2', expires_at: FUTURE.toISOString() }]);
	});

	it('removes a session', () => {
		recordSession('ws-remove', 'u1', 'g1', FUTURE);
		removeSession('ws-remove');
		expect(session('ws-remove')).toEqual([]);
	});

	it('sweeps only expired sessions', () => {
		recordSession('ws-live', 'u1', 'g1', FUTURE);
		recordSession('ws-dead', 'u1', 'g1', PAST);
		cleanupExpiredSessions();
		expect(session('ws-live')).toHaveLength(1);
		expect(session('ws-dead')).toEqual([]);
	});
});
