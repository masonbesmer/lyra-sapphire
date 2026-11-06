import { describe, expect, it, vi } from 'vitest';
import {
	applyFilters,
	buildEQPreset,
	clearFilters,
	EQ_BAND_COUNT,
	EQ_PRESET_NAMES,
	FILTER_NAMES,
	getActiveFilters,
	getCustomEq,
	getEqPresetGains,
	setCustomEq,
	toggleFilter
} from '../../src/lib/lavalinkFilters';

function fakePlayer() {
	const setFilters = vi.fn(async (_filters: unknown) => {});
	return { player: { data: new Map<string, unknown>(), shoukaku: { setFilters } } as never, setFilters };
}

describe('preset names', () => {
	it('lists the Lavalink filter presets and EQ presets', () => {
		expect(FILTER_NAMES).toEqual(expect.arrayContaining(['8D', 'nightcore', 'vaporwave', 'bassboost', 'karaoke', 'soft']));
		expect(EQ_PRESET_NAMES).toEqual(expect.arrayContaining(['Flat', 'Rock', 'Pop', 'Techno']));
	});
});

describe('buildEQPreset', () => {
	it('returns null for an unknown preset', () => {
		expect(buildEQPreset('NotAPreset')).toBeNull();
	});

	it('builds one band per gain for every known preset', () => {
		for (const name of EQ_PRESET_NAMES) {
			const equalizer = buildEQPreset(name)?.equalizer;
			expect(equalizer).toHaveLength(EQ_BAND_COUNT);
			expect(equalizer?.map((entry) => entry.band)).toEqual([...Array(EQ_BAND_COUNT).keys()]);
		}
	});
});

describe('getEqPresetGains', () => {
	it('returns a copy that callers can mutate safely', () => {
		const gains = getEqPresetGains('Rock')!;
		gains[0] = 99;
		expect(getEqPresetGains('Rock')![0]).toBe(0.3);
		expect(getEqPresetGains('Nope')).toBeNull();
	});
});

describe('active filters', () => {
	it('creates the set on first access and reuses it', () => {
		const { player } = fakePlayer();
		const first = getActiveFilters(player);
		expect(first.size).toBe(0);
		expect(getActiveFilters(player)).toBe(first);
	});

	it('throws on an unknown filter without touching Lavalink', async () => {
		const { player, setFilters } = fakePlayer();
		await expect(toggleFilter(player, 'bogus')).rejects.toThrow('Unknown filter: bogus');
		expect(setFilters).not.toHaveBeenCalled();
	});

	it('toggles a filter on and off and applies each state', async () => {
		const { player, setFilters } = fakePlayer();
		expect(await toggleFilter(player, 'nightcore')).toBe(true);
		expect(setFilters).toHaveBeenLastCalledWith({ timescale: { speed: 1.25, pitch: 1.25, rate: 1.0 } });
		expect(await toggleFilter(player, 'nightcore')).toBe(false);
		expect(setFilters).toHaveBeenLastCalledWith({});
	});
});

describe('custom EQ', () => {
	it('defaults to flat', () => {
		const { player } = fakePlayer();
		expect(getCustomEq(player)).toEqual(Array.from({ length: EQ_BAND_COUNT }, () => 0));
	});

	it('zero-fills missing bands and truncates extra ones', async () => {
		const { player } = fakePlayer();
		expect(await setCustomEq(player, [0.1, 0.2])).toEqual([0.1, 0.2, ...Array.from({ length: EQ_BAND_COUNT - 2 }, () => 0)]);
		expect(
			await setCustomEq(
				player,
				Array.from({ length: 20 }, () => 0.05)
			)
		).toHaveLength(EQ_BAND_COUNT);
	});
});

describe('applyFilters', () => {
	it('sums EQ bands from presets and the custom EQ', async () => {
		const { player, setFilters } = fakePlayer();
		getActiveFilters(player).add('bassboost_low').add('bassboost');
		await setCustomEq(player, [0.05]);
		const { equalizer } = setFilters.mock.lastCall![0] as { equalizer: { band: number; gain: number }[] };
		expect(equalizer[0].gain).toBeCloseTo(0.15 + 0.3 + 0.05);
		expect(equalizer[1].gain).toBeCloseTo(0.12 + 0.25);
		expect(equalizer[14].gain).toBe(0);
	});

	it('lets the later preset win a conflicting non-EQ key', async () => {
		const { player, setFilters } = fakePlayer();
		getActiveFilters(player).add('lowpass').add('soft');
		await applyFilters(player);
		expect(setFilters).toHaveBeenLastCalledWith({ lowPass: { smoothing: 5.0 } });
	});

	it('adds no equalizer key for an all-zero custom EQ', async () => {
		const { player, setFilters } = fakePlayer();
		getActiveFilters(player).add('8D');
		await setCustomEq(player, []);
		expect(setFilters).toHaveBeenLastCalledWith({ rotation: { rotationHz: 0.2 } });
	});
});

describe('clearFilters', () => {
	it('empties active filters, flattens the custom EQ and clears Lavalink', async () => {
		const { player, setFilters } = fakePlayer();
		getActiveFilters(player).add('8D');
		await setCustomEq(player, [0.3]);
		await clearFilters(player);
		expect(getActiveFilters(player).size).toBe(0);
		expect(getCustomEq(player)).toEqual(Array.from({ length: EQ_BAND_COUNT }, () => 0));
		expect(setFilters).toHaveBeenLastCalledWith({});
	});
});
