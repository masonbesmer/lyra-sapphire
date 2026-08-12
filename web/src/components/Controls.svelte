<script lang="ts">
  import type { guildApi } from '../lib/api';
  import type { SerializedPlayer } from '../lib/types';
  import VolumeSlider from './VolumeSlider.svelte';

  export let queue: SerializedPlayer | null = null;
  export let api: ReturnType<typeof guildApi>;
</script>

<div class="controls">
  <div class="btn-row">
    <button on:click={() => api.post('skip')}>⏭ Skip</button>
    <button on:click={() => api.post('pause')}>{queue?.paused ? '▶ Resume' : '⏸ Pause'}</button>
    <button on:click={() => api.post('stop')}>⏹ Stop</button>
    <button on:click={() => api.post('shuffle')}>🔀 Shuffle</button>
  </div>

  <VolumeSlider volume={queue?.volume ?? 25} {api} />
</div>

<style>
  .controls { background: #16213e; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .btn-row button { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
  .btn-row button:hover { background: #5865f2; }
</style>
