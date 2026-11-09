<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { PlaylistLists, PlaylistSummary, SerializedPlayer } from '../lib/types';
  import { addNowPlaying, writablePlaylists } from '../lib/playlists';

  export let api: ReturnType<typeof guildApi>;
  export let queue: SerializedPlayer | null;

  let playlists: PlaylistSummary[] = [];
  let selectedId: number | null = null;
  let adding = false;

  async function load() {
    const lists = await api.get<PlaylistLists>('playlists', { quiet: true });
    playlists = lists ? writablePlaylists(lists) : [];
    if (!playlists.some((playlist) => playlist.id === selectedId)) selectedId = playlists[0]?.id ?? null;
  }

  async function add() {
    const playlist = playlists.find((p) => p.id === selectedId);
    if (!playlist) return;
    adding = true;
    try {
      await addNowPlaying(api, playlist);
    } finally {
      adding = false;
    }
  }

  onMount(load);
</script>

{#if queue?.current && playlists.length}
  <div class="add-now-playing">
    <span>📚 Save <strong>{queue.current.title}</strong> to</span>
    <select bind:value={selectedId}>
      {#each playlists as playlist (playlist.id)}
        <option value={playlist.id}>{playlist.name}</option>
      {/each}
    </select>
    <button on:click={add} disabled={adding || selectedId === null}>{adding ? '…' : 'Add to playlist'}</button>
  </div>
{/if}

<style>
  .add-now-playing { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; background: #16213e; border-radius: 10px; padding: 0.75rem 1rem; font-size: 0.85rem; color: #a0a0c0; }
  .add-now-playing span { flex: 1; min-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  select { background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.3rem 0.5rem; border-radius: 6px; }
  button { background: #5865f2; color: white; border: none; padding: 0.35rem 0.8rem; border-radius: 6px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
