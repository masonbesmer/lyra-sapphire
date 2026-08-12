/** Thin fetch wrapper so every component isn't hand-rolling its own error handling. */

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
	const res = await fetch(path, init).catch(() => null);
	if (!res || !res.ok) return null;
	return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T | null> {
	return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown = {}): Promise<T | null> {
	return request<T>(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** Scoped helper for the /api/guilds/:guildId/* routes, which is most of the dashboard's surface. */
export function guildApi(guildId: string) {
	return {
		get: <T>(endpoint: string) => apiGet<T>(`/api/guilds/${guildId}/${endpoint}`),
		post: <T>(endpoint: string, body?: unknown) => apiPost<T>(`/api/guilds/${guildId}/${endpoint}`, body)
	};
}
