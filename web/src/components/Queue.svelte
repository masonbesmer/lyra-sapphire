<script lang="ts">
  import type { guildApi } from '../lib/api';
  import type { SerializedPlayer } from '../lib/types';

  export let queue: SerializedPlayer | null = null;
  export let api: ReturnType<typeof guildApi>;

  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;

  function onDragStart(e: DragEvent, i: number) {
    draggedIndex = i;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    }
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    dragOverIndex = i;
  }

  function onDragLeave(i: number) {
    if (dragOverIndex === i) dragOverIndex = null;
  }

  function onDrop(e: DragEvent, i: number) {
    e.preventDefault();
    const from = draggedIndex;
    draggedIndex = null;
    dragOverIndex = null;
    if (from === null || from === i) return;
    api.post('move', { from: from + 1, to: i + 1 });
  }

  function onDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
  }
</script>

<div class="queue">
  <h3>📋 Queue ({queue?.tracks?.length ?? 0} tracks)</h3>
  {#if !queue?.tracks?.length}
    <p class="empty">No tracks queued.</p>
  {:else}
    <ul>
      {#each queue.tracks as track, i (track.url ?? i)}
        <li
          draggable="true"
          class:dragging={draggedIndex === i}
          class:drag-over={dragOverIndex === i && draggedIndex !== i}
          on:dragstart={(e) => onDragStart(e, i)}
          on:dragover={(e) => onDragOver(e, i)}
          on:dragleave={() => onDragLeave(i)}
          on:drop={(e) => onDrop(e, i)}
          on:dragend={onDragEnd}
        >
          <span class="handle" title="Drag to reorder">⠿</span>
          <span class="num">{i + 1}.</span>
          <div class="info">
            <a href={track.url} target="_blank" rel="noopener">{track.title}</a>
            <span class="meta">{track.author} • {track.duration} • Requested by @{track.requestedBy?.username ?? '?'}</span>
          </div>
          <button class="remove" on:click={() => api.post('remove', { position: i + 1 })} title="Remove">✕</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .queue { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; max-height: 400px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-radius: 6px; background: #0f0f1e; border: 2px solid transparent; }
  li:hover { background: #1e2a50; }
  li.dragging { opacity: 0.4; }
  li.drag-over { border-color: #5865f2; }
  .handle { color: #4a4a6a; cursor: grab; font-size: 1rem; padding: 0 0.2rem; }
  .handle:active { cursor: grabbing; }
  .num { color: #6a6a8a; font-size: 0.8rem; min-width: 24px; text-align: right; }
  .info { flex: 1; overflow: hidden; }
  .info a { color: #a0c4ff; text-decoration: none; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .info a:hover { text-decoration: underline; }
  .meta { font-size: 0.75rem; color: #6a6a8a; }
  .remove { background: transparent; border: none; color: #6a6a8a; cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 4px; }
  .remove:hover { color: #f04747; background: rgba(240,71,71,0.1); }
  .empty { color: #6a6a8a; font-size: 0.9rem; }
</style>
