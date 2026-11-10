<script lang="ts">
  import type { guildApi } from '../lib/api';
  import type { SerializedPlayer } from '../lib/types';

  export let queue: SerializedPlayer | null = null;
  export let api: ReturnType<typeof guildApi>;

  interface LyricsResponse {
    lyrics: string | null;
    query: string;
    title?: string;
  }

  let result: LyricsResponse | null = null;
  let loading = false;
  let open = false;

  async function fetchLyrics() {
    open = true;
    loading = true;
    result = await api.get<LyricsResponse>('lyrics');
    loading = false;
  }

  // Collapse and drop stale lyrics whenever the playing track changes.
  $: if (queue?.current?.url) {
    open = false;
    result = null;
  }
</script>

<div class="lyrics">
  <button class="toggle" on:click={fetchLyrics} disabled={!queue?.current}>📜 {open ? 'Refresh Lyrics' : 'Show Lyrics'}</button>
  {#if open}
    <div class="panel">
      {#if loading}
        <p class="empty">Searching...</p>
      {:else if !result?.lyrics}
        <p class="empty">No lyrics found{result?.query ? ` for "${result.query}"` : ''}.</p>
      {:else}
        {#if result.title}<h4>{result.title}</h4>{/if}
        <pre>{result.lyrics}</pre>
      {/if}
    </div>
  {/if}
</div>

<style>
  .lyrics { background: var(--color-surface); border-radius: 10px; padding: 1rem; }
  .toggle { background: var(--color-control); color: var(--color-text); border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; }
  .toggle:hover:not(:disabled) { background: var(--color-accent); color: var(--color-on-accent); }
  .toggle:disabled { opacity: 0.5; cursor: not-allowed; }
  .panel { margin-top: 0.75rem; max-height: 300px; overflow-y: auto; }
  h4 { margin: 0 0 0.5rem; color: var(--color-link); }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 0.85rem; color: var(--color-text); margin: 0; }
  .empty { color: var(--color-text-subtle); font-size: 0.9rem; margin: 0; }
</style>
