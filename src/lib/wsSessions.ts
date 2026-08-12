import { db } from './database';

export type ActiveSession = {
	session_id: string;
	user_id: string;
	guild_id: string;
	created_at: string;
	expires_at: string;
};

/** Records (or updates, if the connection re-subscribes to a different guild) an active WS session. */
export function recordSession(sessionId: string, userId: string, guildId: string, expiresAt: Date): void {
	db.prepare(
		`INSERT INTO active_sessions (session_id, user_id, guild_id, created_at, expires_at)
		VALUES (@session_id, @user_id, @guild_id, @created_at, @expires_at)
		ON CONFLICT(session_id) DO UPDATE SET guild_id = excluded.guild_id, expires_at = excluded.expires_at`
	).run({
		session_id: sessionId,
		user_id: userId,
		guild_id: guildId,
		created_at: new Date().toISOString(),
		expires_at: expiresAt.toISOString()
	});
}

/** Removes a session's row, e.g. when its WebSocket connection closes. */
export function removeSession(sessionId: string): void {
	db.prepare(`DELETE FROM active_sessions WHERE session_id = ?`).run(sessionId);
}

/** Sweeps rows whose underlying auth session has expired. */
export function cleanupExpiredSessions(): void {
	db.prepare(`DELETE FROM active_sessions WHERE expires_at < ?`).run(new Date().toISOString());
}
