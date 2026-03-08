import type { FilterOptions } from 'shoukaku';
import type { KazagumoPlayer } from 'kazagumo';

// ── Equalizer band helpers ────────────────────────────────────────────────────

function bands(gains: number[]): FilterOptions['equalizer'] {
	return gains.map((gain, band) => ({ band, gain }));
}

// ── Filter preset definitions ─────────────────────────────────────────────────

/**
 * Named filter presets mapped to Lavalink FilterOptions.
 * Keys are the human-readable names shown in Discord UI.
 */
export const LAVALINK_FILTER_PRESETS: Record<string, FilterOptions> = {
	'8D': { rotation: { rotationHz: 0.2 } },
	nightcore: { timescale: { speed: 1.25, pitch: 1.25, rate: 1.0 } },
	vaporwave: { timescale: { speed: 0.85, pitch: 0.85, rate: 1.0 } },
	bassboost_low: { equalizer: bands([0.15, 0.12, 0.08, 0.04, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]) },
	bassboost: { equalizer: bands([0.3, 0.25, 0.15, 0.08, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]) },
	bassboost_high: { equalizer: bands([0.6, 0.5, 0.3, 0.15, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]) },
	tremolo: { tremolo: { frequency: 2.0, depth: 0.5 } },
	vibrato: { vibrato: { frequency: 2.0, depth: 0.5 } },
	karaoke: { karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 } },
	lowpass: { lowPass: { smoothing: 20.0 } },
	soft: { lowPass: { smoothing: 5.0 } }
};

/** All valid preset names. */
export const FILTER_NAMES = Object.keys(LAVALINK_FILTER_PRESETS);

// ── EQ presets (replaces @discord-player/equalizer) ──────────────────────────

const EQ: Record<string, number[]> = {
	Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	Classical: [-0.1, 0.1, 0.1, 0.1, 0.0, -0.15, 0.0, 0.0, 0.0, 0.0, 0.1, 0.1, 0.15, 0.15, 0.1],
	Club: [0.0, 0.0, 0.08, 0.2, 0.26, 0.26, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
	Dance: [0.2, 0.15, 0.04, 0.0, 0.0, -0.1, -0.05, 0.0, 0.04, 0.0, 0.0, 0.0, 0.12, 0.15, 0.2],
	FullBass: [-0.1, 0.1, 0.1, 0.15, 0.2, 0.25, 0.25, 0.25, 0.2, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0],
	FullBassTreble: [0.15, 0.15, 0.0, -0.15, -0.15, 0.0, 0.25, 0.15, 0.0, 0.0, 0.1, 0.15, 0.2, 0.25, 0.3],
	FullTreble: [-0.3, -0.3, -0.3, -0.15, 0.0, 0.15, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
	Headphones: [0.05, 0.1, 0.15, 0.05, -0.1, -0.05, 0.1, 0.25, 0.3, 0.25, 0.1, -0.05, -0.1, 0.05, 0.15],
	LargeHall: [0.12, 0.12, 0.0, 0.0, -0.1, -0.1, 0.0, 0.0, 0.12, 0.12, 0.12, 0.12, 0.0, 0.0, 0.0],
	Live: [-0.3, 0.0, 0.1, 0.12, 0.12, 0.12, 0.1, 0.08, 0.08, 0.1, 0.12, 0.12, 0.08, 0.06, 0.02],
	Party: [0.2, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.2],
	Pop: [-0.1, 0.1, 0.2, 0.28, 0.22, 0.1, -0.05, -0.1, -0.1, -0.05, 0.05, 0.1, 0.18, 0.22, 0.18],
	Reggae: [0.0, 0.0, -0.1, -0.15, 0.0, 0.2, 0.25, 0.2, 0.0, -0.1, -0.1, 0.0, 0.0, 0.0, 0.0],
	Rock: [0.3, 0.25, 0.2, 0.1, 0.05, -0.05, -0.1, -0.1, -0.05, 0.05, 0.2, 0.25, 0.3, 0.3, 0.3],
	Ska: [-0.1, -0.1, 0.0, 0.15, 0.2, 0.25, 0.2, 0.1, -0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
	Soft: [0.1, 0.1, 0.15, 0.2, 0.2, 0.1, 0.05, 0.0, 0.0, 0.0, -0.05, -0.1, -0.1, -0.1, -0.05],
	SoftRock: [0.2, 0.2, 0.1, 0.05, -0.1, -0.15, -0.2, -0.2, -0.15, -0.1, 0.0, 0.05, 0.1, 0.2, 0.25],
	Techno: [0.2, 0.2, 0.15, 0.0, -0.1, -0.1, 0.0, 0.15, 0.2, 0.2, 0.15, 0.0, -0.1, -0.15, -0.2]
};

export const EQ_PRESET_NAMES = Object.keys(EQ);

export function buildEQPreset(name: string): FilterOptions | null {
	const g = EQ[name];
	if (!g) return null;
	return { equalizer: bands(g) };
}

// ── Player.data keys ──────────────────────────────────────────────────────────

export const DATA_ACTIVE_FILTERS = 'activeFilters';

// ── Active filter helpers ─────────────────────────────────────────────────────

/** Return the set of active filter names stored on a player. */
export function getActiveFilters(player: KazagumoPlayer): Set<string> {
	let set = player.data.get(DATA_ACTIVE_FILTERS) as Set<string> | undefined;
	if (!set) {
		set = new Set();
		player.data.set(DATA_ACTIVE_FILTERS, set);
	}
	return set;
}

/**
 * Toggle a named filter preset on the player.
 * Merges all currently-active presets and applies them to Lavalink.
 */
export async function toggleFilter(player: KazagumoPlayer, filterName: string): Promise<boolean> {
	if (!LAVALINK_FILTER_PRESETS[filterName]) throw new Error(`Unknown filter: ${filterName}`);

	const active = getActiveFilters(player);
	if (active.has(filterName)) {
		active.delete(filterName);
	} else {
		active.add(filterName);
	}

	await applyFilters(player);
	return active.has(filterName);
}

/** Merge all active filter presets and send them to Lavalink. */
export async function applyFilters(player: KazagumoPlayer): Promise<void> {
	const active = getActiveFilters(player);
	const merged = mergeFilterPresets([...active]);
	await player.shoukaku.setFilters(merged);
}

/** Clear all active filters. */
export async function clearFilters(player: KazagumoPlayer): Promise<void> {
	getActiveFilters(player).clear();
	await player.shoukaku.setFilters({});
}

/**
 * Merge multiple filter presets into a single FilterOptions object.
 * Later presets override earlier ones for conflicting keys.
 * Equalizer bands are summed (clamped to [-0.25, 1.0]).
 */
function mergeFilterPresets(names: string[]): FilterOptions {
	const merged: FilterOptions = {};
	const eqAccum = new Array<number>(15).fill(0);
	let hasEq = false;

	for (const name of names) {
		const preset = LAVALINK_FILTER_PRESETS[name];
		if (!preset) continue;

		if (preset.equalizer) {
			hasEq = true;
			for (const { band, gain } of preset.equalizer) {
				eqAccum[band] = (eqAccum[band] ?? 0) + gain;
			}
		}
		if (preset.rotation) merged.rotation = preset.rotation;
		if (preset.timescale) merged.timescale = preset.timescale;
		if (preset.tremolo) merged.tremolo = preset.tremolo;
		if (preset.vibrato) merged.vibrato = preset.vibrato;
		if (preset.karaoke) merged.karaoke = preset.karaoke;
		if (preset.lowPass) merged.lowPass = preset.lowPass;
		if (preset.distortion) merged.distortion = preset.distortion;
		if (preset.channelMix) merged.channelMix = preset.channelMix;
	}

	if (hasEq) {
		merged.equalizer = eqAccum.map((gain, band) => ({
			band,
			gain: Math.max(-0.25, Math.min(1.0, gain))
		}));
	}

	return merged;
}
