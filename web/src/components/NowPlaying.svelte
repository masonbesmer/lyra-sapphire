<script lang="ts">
  import type { guildApi } from '../lib/api';
  import type { SerializedPlayer, LoopMode } from '../lib/types';
  import ProgressBar from './ProgressBar.svelte';

  export let queue: SerializedPlayer | null = null;
  export let api: ReturnType<typeof guildApi>;

  const LOOP_LABELS: Record<LoopMode, string> = { none: 'Off', track: 'Track', queue: 'Queue' };
</script>

<div class="now-playing">
  {#if queue?.current}
    <div class="track-info">
      {#if queue.current.thumbnail}
        <img src={queue.current.thumbnail} alt="thumbnail" />
      {/if}
      <div class="meta">
        <a href={queue.current.url} target="_blank" rel="noopener">{queue.current.title}</a>
        <span class="author">{queue.current.author}</span>
        <span class="requester">Requested by: {queue.current.requestedBy?.username ?? 'Unknown'}</span>
      </div>
    </div>
    <ProgressBar {queue} {api} />
    <div class="status">
      <span>🔊 {queue.volume}%</span>
      <span>{queue.paused ? '⏸ Paused' : '▶ Playing'}</span>
      <span>🔁 {LOOP_LABELS[queue.loop] ?? 'Off'}</span>
    </div>
  {:else}
    <div class="empty">Nothing is playing right now.</div>
  {/if}
</div>

<style>
  .now-playing { background: #16213e; border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .track-info { display: flex; gap: 1rem; align-items: flex-start; }
  .track-info img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; }
  .meta { display: flex; flex-direction: column; gap: 0.2rem; }
  .meta a { color: #a0c4ff; font-weight: 600; font-size: 1rem; text-decoration: none; }
  .meta a:hover { text-decoration: underline; }
  .author { color: #a0a0c0; font-size: 0.85rem; }
  .requester { color: #6a6a8a; font-size: 0.8rem; }
  .status { display: flex; gap: 1rem; font-size: 0.85rem; color: #a0a0c0; }
  .empty { text-align: center; color: #6a6a8a; padding: 1rem; }
</style>
