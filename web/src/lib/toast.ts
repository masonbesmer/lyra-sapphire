import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	message: string;
	kind: 'error' | 'info';
}

/** Transient user-facing notices - rendered once, globally, by Toasts.svelte. */
export const toasts = writable<Toast[]>([]);

let nextId = 0;

function push(message: string, kind: Toast['kind'], ttl: number): void {
	const id = nextId++;
	toasts.update((list) => [...list, { id, message, kind }]);
	setTimeout(() => dismissToast(id), ttl);
}

export function pushError(message: string): void {
	push(message, 'error', 6000);
}

export function pushInfo(message: string): void {
	push(message, 'info', 3000);
}

export function dismissToast(id: number): void {
	toasts.update((list) => list.filter((t) => t.id !== id));
}
