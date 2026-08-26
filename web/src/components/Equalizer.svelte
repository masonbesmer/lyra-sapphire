<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { EqualizerResponse, SerializedPlayer } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let queue: SerializedPlayer | null = null;

  const MIN = -0.25;
  const MAX = 1.0;
  const UNLOCKED_MIN = -1;
  const UNLOCKED_MAX = 2;
  const UNLOCK_CLICKS = 10;
  const FLAT = new Array<number>(15).fill(0);

  let frequencies: number[] = [];
  let presets: string[] = [];
  let loading = true;

  /** Secret: click the title 10 times to raise this session's own slider range. Local only - not synced. */
  let unlocked = false;
  let unlockClicks = 0;

  $: sliderMin = unlocked ? UNLOCKED_MIN : MIN;
  $: sliderMax = unlocked ? UNLOCKED_MAX : MAX;

  function onTitleClick() {
    if (unlocked) return;
    unlockClicks += 1;
    if (unlockClicks >= UNLOCK_CLICKS) unlocked = true;
  }

  /**
   * True from the first drag/preset click until the POST resolves. While true, `gains` is the
   * local source of truth so incoming queue updates (e.g. the progress-interval queueUpdate
   * ticking every second) can't yank the sliders back mid-interaction.
   */
  let dragging = false;
  let gains: number[] = FLAT;

  $: if (!dragging) gains = queue?.eq ?? FLAT;

  onMount(async () => {
    const data = await api.get<EqualizerResponse>('equalizer');
    if (data) {
      frequencies = data.frequencies;
      presets = data.presets;
    }
    loading = false;
  });

  function formatFreq(hz: number): string {
    if (hz >= 1000) return `${(hz / 1000).toString().replace(/\.0$/, '')}k`;
    return `${hz}`;
  }

  function onInput(band: number, e: Event) {
    const value = parseFloat((e.currentTarget as HTMLInputElement).value);
    dragging = true;
    gains = gains.map((g, i) => (i === band ? value : g));
  }

  async function commit() {
    await api.post('equalizer', { gains });
    dragging = false;
  }

  async function applyPreset(name: string) {
    dragging = true;
    const res = await api.post<{ ok: boolean; gains: number[] }>('equalizer', { preset: name });
    if (res) gains = res.gains;
    dragging = false;
  }

  async function reset() {
    dragging = true;
    gains = FLAT;
    await api.post('equalizer', { gains: FLAT });
    dragging = false;
  }
</script>

<div class="equalizer">
  <div class="header">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <h3 class:unlocked on:click={onTitleClick}>🎚️ Equalizer</h3>
    <button class="reset" on:click={reset} disabled={loading}>Reset</button>
  </div>

  {#if loading}
    <p class="empty">Loading...</p>
  {:else}
    <div class="bands">
      {#each frequencies as freq, i}
        <div class="band">
          <span class="gain">{gains[i] >= 0 ? '+' : ''}{gains[i].toFixed(2)}</span>
          <input
            type="range"
            class="slider"
            min={sliderMin}
            max={sliderMax}
            step="0.01"
            value={gains[i]}
            on:input={(e) => onInput(i, e)}
            on:change={commit}
          />
          <span class="freq">{formatFreq(freq)}</span>
        </div>
      {/each}
    </div>

    {#if presets.length}
      <div class="presets">
        {#each presets as name}
          <button on:click={() => applyPreset(name)}>{name}</button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .equalizer { background: #16213e; border-radius: 10px; padding: 1rem; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
  h3 { margin: 0; font-size: 1rem; user-select: none; cursor: default; }
  h3.unlocked { color: #f5b942; }
  .reset { background: #0f0f1e; border: 1px solid #2a2a4a; color: #a0a0c0; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; }
  .reset:hover { border-color: #5865f2; }
  .empty { color: #6a6a8a; font-size: 0.9rem; margin: 0; }

  .bands { display: flex; justify-content: space-between; gap: 0.25rem; overflow-x: auto; padding-bottom: 0.25rem; }
  .band { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; flex: 1 0 1.6rem; }
  .gain { font-size: 0.65rem; color: #6a6a8a; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .freq { font-size: 0.65rem; color: #6a6a8a; white-space: nowrap; }

  .slider {
    -webkit-appearance: slider-vertical;
    writing-mode: vertical-lr;
    direction: rtl;
    width: 6px;
    height: 100px;
    accent-color: #5865f2;
    cursor: pointer;
  }

  .presets { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #2a2a4a; }
  .presets button { background: #0f0f1e; border: 1px solid #2a2a4a; color: #a0a0c0; padding: 0.3rem 0.75rem; border-radius: 20px; cursor: pointer; font-size: 0.75rem; transition: all 0.15s; }
  .presets button:hover { border-color: #5865f2; color: #e0e0f0; }
</style>
