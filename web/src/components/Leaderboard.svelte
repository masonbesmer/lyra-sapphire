<script lang="ts">
  import { onMount } from 'svelte';
  import { guildApi } from '../lib/api';
  import type { LeaderboardEntry } from '../lib/types';

  export let guildId: string;

  type Stat = 'messages' | 'voice';
  type Period = 'all' | 'weekly' | 'monthly';

  let stat: Stat = 'messages';
  let period: Period = 'all';
  let entries: LeaderboardEntry[] = [];
  let loading = false;

  const api = guildApi(guildId);

  async function load() {
    loading = true;
    entries = (await api.get<LeaderboardEntry[]>(`leaderboard?stat=${stat}&period=${period}`)) ?? [];
    loading = false;
  }

  onMount(load);
  $: {
    void stat;
    void period;
    load();
  }

  function fmtValue(v: number): string {
    if (stat === 'messages') return `${v.toLocaleString()} msgs`;
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const MEDALS = ['🥇', '🥈', '🥉'];
</script>

<div class="leaderboard">
  <h3>🏆 Leaderboard</h3>
  <div class="filters">
    <select bind:value={stat}>
      <option value="messages">💬 Messages</option>
      <option value="voice">🎙️ Voice time</option>
    </select>
    <select bind:value={period}>
      <option value="all">All time</option>
      <option value="weekly">Past week</option>
      <option value="monthly">Past month</option>
    </select>
  </div>

  {#if loading}
    <p class="empty">Loading...</p>
  {:else if !entries.length}
    <p class="empty">No activity recorded yet.</p>
  {:else}
    <ol>
      {#each entries as entry, i}
        <li>
          <span class="rank">{MEDALS[i] ?? `${i + 1}.`}</span>
          <span class="name">{entry.username}</span>
          <span class="value">{fmtValue(entry.value)}</span>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .leaderboard { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  .filters { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .filters select { background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.85rem; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.6rem; border-radius: 6px; background: #0f0f1e; }
  .rank { min-width: 2rem; text-align: center; font-size: 0.9rem; color: #a0a0c0; }
  .name { flex: 1; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .value { color: #a0c4ff; font-size: 0.85rem; white-space: nowrap; }
  .empty { color: #6a6a8a; font-size: 0.9rem; margin: 0; }
</style>
