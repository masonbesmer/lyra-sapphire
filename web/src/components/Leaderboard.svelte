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
  .leaderboard { background: var(--color-surface); border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  .filters { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .filters select { background: var(--color-surface-sunken); border: 1px solid var(--color-border); color: var(--color-text); padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.85rem; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.6rem; border-radius: 6px; background: var(--color-surface-sunken); }
  .rank { min-width: 2rem; text-align: center; font-size: 0.9rem; color: var(--color-text-muted); }
  .name { flex: 1; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .value { color: var(--color-link); font-size: 0.85rem; white-space: nowrap; }
  .empty { color: var(--color-text-subtle); font-size: 0.9rem; margin: 0; }
</style>
