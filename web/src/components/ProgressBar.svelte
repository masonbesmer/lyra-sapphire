<script lang="ts">
  import type { guildApi } from '../lib/api';
  import type { SerializedPlayer } from '../lib/types';

  export let queue: SerializedPlayer;
  export let api: ReturnType<typeof guildApi>;

  function fmtTime(ms: number): string {
    if (!ms) return '0:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  $: duration = queue.current?.durationMS ?? 0;
  $: pct = duration ? Math.min((queue.position / duration) * 100, 100) : 0;

  function seekTo(e: MouseEvent) {
    if (!duration) return;
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    api.post('seek', { position: Math.round(frac * duration) });
  }
</script>

<div class="progress">
  <button class="bar" on:click={seekTo} aria-label="Seek" title="Click to seek">
    <div class="fill" style="width: {pct}%"></div>
  </button>
  <div class="times">
    <span>{fmtTime(queue.position)}</span>
    <span>{fmtTime(duration)}</span>
  </div>
</div>

<style>
  .progress { display: flex; flex-direction: column; gap: 0.3rem; }
  .bar { all: unset; box-sizing: border-box; display: block; width: 100%; height: 8px; background: #2a2a4a; border-radius: 4px; overflow: hidden; cursor: pointer; }
  .fill { height: 100%; background: #5865f2; transition: width 0.9s linear; }
  .times { display: flex; justify-content: space-between; font-size: 0.75rem; color: #6a6a8a; }
</style>
