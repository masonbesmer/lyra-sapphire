<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { VoiceChannel, SearchResponse, SerializedTrack } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;

  let voiceChannels: VoiceChannel[] = [];
  let selectedChannelId = '';
  let query = '';
  let results: SerializedTrack[] = [];
  let searching = false;
  let queuedUrl: string | null = null;

  onMount(async () => {
    voiceChannels = (await api.get<VoiceChannel[]>('channels?type=voice')) ?? [];
  });

  async function search() {
    if (!query.trim()) return;
    searching = true;
    results = [];
    const data = await api.get<SearchResponse>(`search?query=${encodeURIComponent(query)}`);
    results = data?.tracks ?? [];
    searching = false;
  }

  async function queueTrack(track: SerializedTrack) {
    if (!selectedChannelId || !track.url) return;
    queuedUrl = track.url;
    await api.post('play', { query: track.url, channelId: selectedChannelId });
    queuedUrl = null;
  }
</script>

<div class="search-bar">
  <h3>🔍 Search</h3>
  <div class="input-row">
    {#if voiceChannels.length}
      <select bind:value={selectedChannelId}>
        <option value="">Select voice channel...</option>
        {#each voiceChannels as ch}
          <option value={ch.id}>{ch.name}</option>
        {/each}
      </select>
    {/if}
    <input bind:value={query} placeholder="Search a song..." on:keydown={(e) => e.key === 'Enter' && search()} />
    <button on:click={search} disabled={searching}>{searching ? '...' : 'Search'}</button>
  </div>

  {#if results.length}
    <ul>
      {#each results as track}
        <li>
          {#if track.thumbnail}<img src={track.thumbnail} alt="" />{/if}
          <div class="info">
            <span class="title">{track.title}</span>
            <span class="meta">{track.author} • {track.duration}</span>
          </div>
          <button
            class="queue-btn"
            disabled={!selectedChannelId || queuedUrl === track.url}
            on:click={() => queueTrack(track)}
          >
            {queuedUrl === track.url ? '…' : '+ Queue'}
          </button>
        </li>
      {/each}
    </ul>
  {:else if searching}
    <p class="empty">Searching...</p>
  {/if}
</div>

<style>
  .search-bar { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  .input-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .input-row select { background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.85rem; }
  .input-row input { flex: 1; background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.9rem; }
  .input-row button { background: #5865f2; color: white; border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; }
  .input-row button:disabled { opacity: 0.6; cursor: not-allowed; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; max-height: 320px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem; border-radius: 6px; background: #0f0f1e; }
  li img { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
  .info { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .title { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 0.75rem; color: #6a6a8a; }
  .queue-btn { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
  .queue-btn:hover:not(:disabled) { background: #5865f2; }
  .queue-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .empty { color: #6a6a8a; font-size: 0.9rem; margin: 0; }
</style>
