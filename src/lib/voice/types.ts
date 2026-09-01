/** Audio format the detection models expect. Everything upstream converts to this. */
export const SAMPLE_RATE = 16_000;
export const FRAME_SAMPLES = 1_280; // 80 ms at 16 kHz — wake-word models need a constant hop
export const FRAME_BYTES = FRAME_SAMPLES * 4; // float32

/** Identifies one user's stream. Guild-scoped because the same user can speak in two guilds. */
export type StreamKey = `${string}:${string}`;

export function streamKey(guildId: string, userId: string): StreamKey {
	return `${guildId}:${userId}`;
}

export function parseStreamKey(key: StreamKey): { guildId: string; userId: string } {
	const [guildId, userId] = key.split(':');
	return { guildId, userId };
}

// ── Worker protocol ──────────────────────────────────────────────────────────
// Frame and utterance payloads are structured-cloned rather than transferred: lib.dom's
// MessagePort wins overload resolution against Node's transferList form. A frame is ~5 KB
// at 12.5/s per user, so the copy is cheap. Senders may keep using their arrays.

export type ToWorkerMessage =
	| { type: 'register'; key: StreamKey }
	| { type: 'unregister'; key: StreamKey }
	| { type: 'config'; key: StreamKey; sensitivity: number; silenceMs: number; maxMs: number }
	| { type: 'frame'; key: StreamKey; pcm: Float32Array };

export type FromWorkerMessage =
	| { type: 'ready' }
	| { type: 'wake'; key: StreamKey; score: number }
	| { type: 'utterance'; key: StreamKey; pcm: Float32Array; durationMs: number }
	| { type: 'error'; key: StreamKey | null; message: string }
	// Throttled health line: how far behind real-time the per-stream frame queue has fallen.
	| { type: 'diag'; key: StreamKey; message: string };
