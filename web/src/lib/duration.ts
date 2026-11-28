/** Mirrors parseDuration/formatDuration in src/lib/moderation.ts, so the dashboard reads and writes durations like the slash commands. */

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** `10m`, `1h30m`, `7d` → ms. null for anything that isn't wholly a duration. */
export function parseDuration(input: string | null | undefined): number | null {
	const text = (input ?? '').trim().toLowerCase().replace(/\s+/g, '');
	if (!text) return null;
	let total = 0;
	let consumed = 0;
	for (const match of text.matchAll(/(\d+)([smhdw])/g)) {
		if (match.index !== consumed) return null;
		total += Number(match[1]) * UNIT_MS[match[2]];
		consumed += match[0].length;
	}
	return consumed === text.length && total > 0 && Number.isSafeInteger(total) ? total : null;
}

/** 93_784_000 → `1d 2h 3m 4s`. */
export function formatDuration(ms: number | null | undefined): string {
	if (!ms || ms <= 0) return '';
	const parts: string[] = [];
	let rest = Math.round(ms / 1000);
	for (const [unit, size] of [
		['w', 604_800],
		['d', 86_400],
		['h', 3_600],
		['m', 60],
		['s', 1]
	] as const) {
		const amount = Math.floor(rest / size);
		if (amount > 0) parts.push(`${amount}${unit}`);
		rest -= amount * size;
	}
	return parts.join(' ');
}
