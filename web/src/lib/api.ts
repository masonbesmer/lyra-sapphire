/** Thin fetch wrapper so every component isn't hand-rolling its own error handling. */

import { pushError } from './toast';

interface ErrorBody {
	/** plugin-api's response.error() shape. */
	error?: string;
	/** Routes that answer 200 with a soft failure, e.g. /play with no search results. */
	ok?: boolean;
}

/**
 * plugin-api fills `error` with the bare HTTP status text unless the route passes
 * its own message, and "Forbidden" alone tells a user nothing. Anything in this set
 * gets replaced by the friendlier copy below.
 */
const GENERIC_ERRORS = new Set([
	'Bad Request',
	'Unauthorized',
	'Forbidden',
	'Not Found',
	'Method Not Allowed',
	'Internal Server Error'
]);

const STATUS_MESSAGES: Record<number, string> = {
	400: "The bot didn't understand that request.",
	401: 'Your session expired - log in again.',
	403: "You're not allowed to do that. Are you in the voice channel?",
	404: 'That server or track is no longer available.',
	405: 'That action is unavailable on this server build.',
	500: 'The bot hit an error handling that. Check its logs.'
};

function errorMessage(status: number, body: ErrorBody | null): string {
	const fromServer = body?.error;
	if (fromServer && !GENERIC_ERRORS.has(fromServer)) return fromServer;
	return STATUS_MESSAGES[status] ?? `Request failed (${status}).`;
}

export interface RequestOptions {
	/** Suppress the error toast, for probes whose failure is expected - e.g. the logged-out /oauth/@me check. */
	quiet?: boolean;
}

async function request<T>(path: string, init?: RequestInit, opts: RequestOptions = {}): Promise<T | null> {
	const report: (message: string) => void = opts.quiet ? () => {} : pushError;

	const res = await fetch(path, init).catch(() => null);
	if (!res) {
		report("Couldn't reach the bot. It may be offline.");
		return null;
	}

	const body = (await res.json().catch(() => null)) as (T & ErrorBody) | null;

	if (!res.ok) {
		report(errorMessage(res.status, body));
		return null;
	}

	// Soft failures come back 200 with { ok: false, error }, so they'd otherwise pass silently.
	if (body && typeof body === 'object' && body.ok === false) {
		report(body.error ?? 'That request went through but did nothing.');
		return null;
	}

	return body;
}

export function apiGet<T>(path: string, opts?: RequestOptions): Promise<T | null> {
	return request<T>(path, undefined, opts);
}

export function apiPost<T>(path: string, body: unknown = {}, opts?: RequestOptions): Promise<T | null> {
	return request<T>(
		path,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		},
		opts
	);
}

/** Scoped helper for the /api/guilds/:guildId/* routes, which is most of the dashboard's surface. */
export function guildApi(guildId: string) {
	return {
		get: <T>(endpoint: string, opts?: RequestOptions) => apiGet<T>(`/api/guilds/${guildId}/${endpoint}`, opts),
		post: <T>(endpoint: string, body?: unknown, opts?: RequestOptions) => apiPost<T>(`/api/guilds/${guildId}/${endpoint}`, body, opts)
	};
}
