<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { SerializedPlayer, VoiceChannel } from '../lib/types';

  export let queue: SerializedPlayer | null = null;
  export let api: ReturnType<typeof guildApi>;

  let seekInput = '';
  let playInput = '';
  let voiceChannels: VoiceChannel[] = [];
  let selectedChannelId = '';

  onMount(async () => {
    voiceChannels = (await api.get<VoiceChannel[]>('channels?type=voice')) ?? [];
  });
</script>

<div class="controls">
  <div class="btn-row">
    <button on:click={() => api.post('skip')}>⏭ Skip</button>
    <button on:click={() => api.post('pause')}>{queue?.paused ? '▶ Resume' : '⏸ Pause'}</button>
    <button on:click={() => api.post('stop')}>⏹ Stop</button>
    <button on:click={() => api.post('shuffle')}>🔀 Shuffle</button>
  </div>

  <div class="input-row">
    {#if voiceChannels.length}
      <select bind:value={selectedChannelId}>
        <option value="">Select voice channel...</option>
        {#each voiceChannels as ch}
          <option value={ch.id}>{ch.name}</option>
        {/each}
      </select>
    {/if}
    <input bind:value={playInput} placeholder="Song name or URL..." on:keydown={(e) => e.key === 'Enter' && selectedChannelId && api.post('play', { query: playInput, channelId: selectedChannelId })} />
    <button on:click={() => selectedChannelId && api.post('play', { query: playInput, channelId: selectedChannelId })} disabled={!selectedChannelId}>▶ Play</button>
  </div>

  <div class="input-row small">
    <label>Volume:</label>
    <input type="range" min="1" max="100" value={queue?.volume ?? 25}
      on:change={(e) => api.post('volume', { volume: parseInt((e.currentTarget as HTMLInputElement).value) })} />
    <span>{queue?.volume ?? 25}%</span>
  </div>

  <div class="input-row small">
    <label>Seek:</label>
    <input type="text" bind:value={seekInput} placeholder="e.g. 1:30 or 90" />
    <button on:click={() => seekInput && api.post('seek', { position: seekInput })}>⏩ Seek</button>
  </div>
</div>

<style>
  .controls { background: #16213e; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .btn-row button { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
  .btn-row button:hover { background: #5865f2; }
  .input-row { display: flex; gap: 0.5rem; align-items: center; }
  .input-row input[type="text"], .input-row input:not([type]) { flex: 1; background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.9rem; }
  .input-row button { background: #5865f2; color: white; border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; }
  .input-row.small label { color: #a0a0c0; font-size: 0.85rem; white-space: nowrap; }
  input[type="range"] { flex: 1; accent-color: #5865f2; }
  span { color: #a0a0c0; font-size: 0.85rem; white-space: nowrap; }
</style>
