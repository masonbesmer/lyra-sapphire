<script>
  export let queue = null;
  export let apiPost;
</script>

<div class="queue">
  <h3>📋 Queue ({queue?.tracks?.length ?? 0} tracks)</h3>
  {#if !queue?.tracks?.length}
    <p class="empty">No tracks queued.</p>
  {:else}
    <ul>
      {#each queue.tracks as track, i}
        <li>
          <span class="num">{i + 1}.</span>
          <div class="info">
            <a href={track.url} target="_blank" rel="noopener">{track.title}</a>
            <span class="meta">{track.author} • {track.duration} • Requested by @{track.requestedBy?.id ?? '?'}</span>
          </div>
          <button class="remove" on:click={() => apiPost('remove', { position: i + 1 })} title="Remove">✕</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .queue { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; max-height: 400px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-radius: 6px; background: #0f0f1e; }
  li:hover { background: #1e2a50; }
  .num { color: #6a6a8a; font-size: 0.8rem; min-width: 24px; text-align: right; }
  .info { flex: 1; overflow: hidden; }
  .info a { color: #a0c4ff; text-decoration: none; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .info a:hover { text-decoration: underline; }
  .meta { font-size: 0.75rem; color: #6a6a8a; }
  .remove { background: transparent; border: none; color: #6a6a8a; cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 4px; }
  .remove:hover { color: #f04747; background: rgba(240,71,71,0.1); }
  .empty { color: #6a6a8a; font-size: 0.9rem; }
</style>
