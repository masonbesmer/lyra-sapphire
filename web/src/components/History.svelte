<script>
  import { onMount } from 'svelte';
  export let guildId;

  let rows = [];
  let page = 1;
  let loading = false;

  async function fetchHistory() {
    loading = true;
    const res = await fetch(`/api/guilds/${guildId}/history?page=${page}&limit=20`);
    if (res.ok) {
      const data = await res.json();
      rows = data.rows;
    }
    loading = false;
  }

  onMount(fetchHistory);

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fmtDur(ms) {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<div class="history">
  <h3>📜 Play History</h3>
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
            <a href={row.track_url} target="_blank" rel="noopener">{row.track_title}</a>
            <span class="meta">{fmtDur(row.track_duration_ms)} • {fmtDate(row.played_at)}</span>
          </div>
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
  .info a { color: #a0c4ff; text-decoration: none; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .meta { font-size: 0.75rem; color: #6a6a8a; }
  .empty { color: #6a6a8a; font-size: 0.9rem; }
  .pagination { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; font-size: 0.85rem; }
  .pagination button { background: #2a2a4a; border: none; color: #e0e0f0; padding: 0.3rem 0.7rem; border-radius: 4px; cursor: pointer; }
  .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
  .pagination span { color: #a0a0c0; }
</style>
