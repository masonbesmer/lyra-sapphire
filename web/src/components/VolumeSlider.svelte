<script lang="ts">
  import type { guildApi } from '../lib/api';

  export let volume: number;
  export let api: ReturnType<typeof guildApi>;

  function onChange(e: Event) {
    const value = parseInt((e.currentTarget as HTMLInputElement).value);
    api.post('volume', { volume: value });
  }
</script>

<div class="volume">
  <label for="volume-slider">🔊</label>
  <input id="volume-slider" type="range" min="1" max="100" value={volume} on:change={onChange} />
  <span>{volume}%</span>
</div>

<style>
  .volume { display: flex; gap: 0.5rem; align-items: center; }
  label { color: #a0a0c0; font-size: 0.85rem; }
  input[type='range'] { flex: 1; accent-color: #5865f2; }
  span { color: #a0a0c0; font-size: 0.85rem; white-space: nowrap; min-width: 2.5rem; text-align: right; }
</style>
