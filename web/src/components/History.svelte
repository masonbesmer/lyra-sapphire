<script lang="ts">
  import { onMount } from 'svelte';
  import { guildApi } from '../lib/api';
  import { queueTrackUrl } from '../lib/player';
  import { voiceState } from '../lib/stores';
  import type { HistoryPage, HistoryRow } from '../lib/types';

  export let guildId: string;

  let rows: HistoryRow[] = [];
  let page = 1;
  let loading = false;
  /** Row id currently being re-queued, so only that row shows a pending state. */
  let replayingId: number | null = null;

  $: api = guildApi(guildId);
  // Replaying queues into the viewer's own channel, exactly like the player tab does.
  $: voiceChannelId = $voiceState?.channelId ?? null;

  async function fetchHistory() {
    loading = true;
    const data = await api.get<HistoryPage>(`history?page=${page}&limit=20`);
    rows = data?.rows ?? [];
    loading = false;
  }

  async function replay(row: HistoryRow) {
    if (!row.track_url || !voiceChannelId) return;
    replayingId = row.id;
    try {
      await queueTrackUrl(api, row.track_url, row.track_title, voiceChannelId);
    } finally {
      replayingId = null;
    }
  }

  onMount(fetchHistory);

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fmtDur(ms: number): string {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<div class="history">
  <h3>📜 Play History</h3>
  {#if !loading && rows.length && !voiceChannelId}
    <p class="hint">Join a voice channel to replay anything from this list.</p>
  {/if}
  {#if loading}
    <p>Loading...</p>
  {:else if !rows.length}
    <p class="empty">No tracks played yet.</p>
  {:else}
    <ul>
      {#each rows as row, i}
        <li>
          <span class="num">{(page - 1) * 20 + i + 1}.</span>
          <div class="info">
            {#if row.track_url}
              <a href={row.track_url} target="_blank" rel="noopener">{row.track_title}</a>
            {:else}
              <span class="title">{row.track_title}</span>
            {/if}
            <span class="meta">{fmtDur(row.track_duration_ms)} • {fmtDate(row.played_at)}</span>
          </div>
          {#if voiceChannelId && row.track_url}
            <button
              class="replay-btn"
              title="Queue this track again"
              disabled={replayingId === row.id}
              on:click={() => replay(row)}
            >
              {replayingId === row.id ? '…' : '↻ Replay'}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="pagination">
      <button on:click={() => { page = Math.max(1, page - 1); fetchHistory(); }} disabled={page === 1}>← Prev</button>
      <span>Page {page}</span>
      <button on:click={() => { page++; fetchHistory(); }} disabled={rows.length < 20}>Next →</button>
    </div>
  {/if}
</div>

<style>
  .history { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; max-height: 500px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-radius: 6px; background: #0f0f1e; }
  .num { color: #6a6a8a; font-size: 0.8rem; min-width: 30px; text-align: right; }
  .info { flex: 1; overflow: hidden; }
  .info .title { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .info a { color: #a0c4ff; text-decoration: none; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .meta { font-size: 0.75rem; color: #6a6a8a; }
  .empty { color: #6a6a8a; font-size: 0.9rem; }
  .hint { color: #6a6a8a; font-size: 0.8rem; margin: 0 0 0.5rem; }
  .replay-btn { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; flex-shrink: 0; }
  .replay-btn:hover:not(:disabled) { background: #5865f2; }
  .replay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pagination { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; font-size: 0.85rem; }
  .pagination button { background: #2a2a4a; border: none; color: #e0e0f0; padding: 0.3rem 0.7rem; border-radius: 4px; cursor: pointer; }
  .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
  .pagination span { color: #a0a0c0; }
</style>
