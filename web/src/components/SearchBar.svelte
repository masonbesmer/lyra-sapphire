<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { SearchResponse, SerializedTrack } from '../lib/types';
  import { queueTrackUrl } from '../lib/player';

  export let api: ReturnType<typeof guildApi>;
  /** Inferred from the viewer's own voice state - Dashboard only renders this when it's set. */
  export let voiceChannelId: string;

  const SUGGEST_DEBOUNCE_MS = 250;
  const MIN_SUGGEST_CHARS = 2;
  const MAX_SUGGESTIONS = 5;

  let query = '';
  let results: SerializedTrack[] = [];
  let searching = false;
  let queuedUrl: string | null = null;

  let suggestions: SerializedTrack[] = [];
  let highlighted = -1;
  let suggestOpen = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow earlier keystroke's response landing after a newer one. */
  let suggestSeq = 0;

  function fetchTracks(q: string) {
    return api.get<SearchResponse>(`search?query=${encodeURIComponent(q)}`, { quiet: true });
  }

  function closeSuggestions() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    suggestOpen = false;
    highlighted = -1;
    suggestions = [];
  }

  function onInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    highlighted = -1;

    const q = query.trim();
    // A pasted link is already the exact track, so there is nothing to suggest.
    if (q.length < MIN_SUGGEST_CHARS || /^https?:\/\//.test(q)) {
      closeSuggestions();
      return;
    }

    debounceTimer = setTimeout(async () => {
      const seq = ++suggestSeq;
      const data = await fetchTracks(q);
      if (seq !== suggestSeq) return;
      suggestions = (data?.tracks ?? []).slice(0, MAX_SUGGESTIONS);
      suggestOpen = suggestions.length > 0;
    }, SUGGEST_DEBOUNCE_MS);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') return closeSuggestions();

    if (suggestOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // Cycle through the suggestions plus one "nothing highlighted" (-1) slot, so Enter can
      // still fall through to a full search without closing the dropdown first.
      const slots = suggestions.length + 1;
      highlighted = ((highlighted + 1 + step + slots) % slots) - 1;
      return;
    }

    if (e.key !== 'Enter') return;
    if (suggestOpen && highlighted >= 0) {
      e.preventDefault();
      queueTrack(suggestions[highlighted]);
      return;
    }
    search();
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    closeSuggestions();
    searching = true;
    results = [];
    const data = await fetchTracks(q);
    results = data?.tracks ?? [];
    searching = false;
  }

  async function queueTrack(track: SerializedTrack) {
    closeSuggestions();
    if (!track.url) return;
    queuedUrl = track.url;
    try {
      await queueTrackUrl(api, track.url, track.title, voiceChannelId);
    } finally {
      queuedUrl = null;
    }
  }

  onDestroy(closeSuggestions);
</script>

<div class="search-bar">
  <h3>🔍 Search</h3>
  <div class="input-row">
    <div class="autocomplete">
      <input
        bind:value={query}
        placeholder="Search a song..."
        autocomplete="off"
        role="combobox"
        aria-expanded={suggestOpen}
        aria-controls="search-suggestions"
        on:input={onInput}
        on:keydown={onKeydown}
        on:blur={closeSuggestions}
      />
      {#if suggestOpen}
        <ul class="suggestions" id="search-suggestions" role="listbox">
          {#each suggestions as track, i}
            <li role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                class:highlighted={i === highlighted}
                on:mousedown|preventDefault
                on:click={() => queueTrack(track)}
              >
                {#if track.thumbnail}<img src={track.thumbnail} alt="" />{/if}
                <span class="title">{track.title}</span>
                <span class="meta">{track.duration}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button on:click={search} disabled={searching}>{searching ? '...' : 'Search'}</button>
  </div>

  {#if results.length}
    <ul class="results">
      {#each results as track}
        <li>
          {#if track.thumbnail}<img src={track.thumbnail} alt="" />{/if}
          <div class="info">
            <span class="title">{track.title}</span>
            <span class="meta">{track.author} • {track.duration}</span>
          </div>
          <button class="queue-btn" disabled={!track.url || queuedUrl === track.url} on:click={() => queueTrack(track)}>
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
  .autocomplete { position: relative; flex: 1; }
  .autocomplete input { width: 100%; box-sizing: border-box; background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.9rem; }
  .input-row > button { background: #5865f2; color: white; border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; }
  .input-row > button:disabled { opacity: 0.6; cursor: not-allowed; }

  .suggestions { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; right: 0; list-style: none; margin: 0; padding: 0.25rem; background: #0f0f1e; border: 1px solid #2a2a4a; border-radius: 6px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45); }
  .suggestions button { display: flex; align-items: center; gap: 0.6rem; width: 100%; padding: 0.35rem 0.5rem; background: none; border: none; border-radius: 4px; color: #e0e0f0; text-align: left; cursor: pointer; font-size: 0.85rem; }
  .suggestions button:hover, .suggestions button.highlighted { background: #5865f2; }
  .suggestions img { width: 28px; height: 28px; object-fit: cover; border-radius: 3px; flex-shrink: 0; }
  .suggestions .title { flex: 1; }

  .results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; max-height: 320px; overflow-y: auto; }
  .results li { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem; border-radius: 6px; background: #0f0f1e; }
  .results img { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
  .info { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .title { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 0.75rem; color: #6a6a8a; flex-shrink: 0; }
  .queue-btn { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
  .queue-btn:hover:not(:disabled) { background: #5865f2; }
  .queue-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .empty { color: #6a6a8a; font-size: 0.9rem; margin: 0; }
</style>
