<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import { formatDuration } from '../lib/duration';
  import type { ModCase, ModCasePage } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let labels: Record<string, string>;

  const dispatch = createEventDispatcher<{ member: string }>();
  const PER_PAGE = 25;

  let cases: ModCase[] = [];
  let total = 0;
  let page = 1;
  let query = '';
  let action = '';
  let loading = true;

  async function load() {
    loading = true;
    const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
    if (query.trim()) params.set('q', query.trim());
    if (action) params.set('action', action);
    const data = await api.get<ModCasePage>(`moderation/cases?${params}`);
    cases = data?.cases ?? [];
    total = data?.total ?? 0;
    loading = false;
  }

  function search() {
    page = 1;
    load();
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function target(entry: ModCase): string {
    if (entry.target_type === 'channel') return `#channel ${entry.target_id}`;
    if (entry.target_type === 'guild') return 'whole server';
    return entry.target_tag ?? entry.target_id;
  }

  $: pages = Math.max(1, Math.ceil(total / PER_PAGE));

  onMount(load);
</script>

<section class="card">
  <h3>📁 Cases</h3>
  <p class="hint">Search by case number (<code>#12</code>), a user ID, or text in the reason, user or moderator name.</p>
  <form class="add-row" on:submit|preventDefault={search}>
    <input type="search" bind:value={query} placeholder="Search cases..." aria-label="Search cases" />
    <select bind:value={action} on:change={search} aria-label="Filter by action">
      <option value="">All actions</option>
      {#each Object.entries(labels) as [key, label]}
        <option value={key}>{label}</option>
      {/each}
    </select>
    <button type="submit" class="primary">Search</button>
  </form>

  {#if loading}
    <p class="empty">Loading...</p>
  {:else if !cases.length}
    <p class="empty">{query || action ? 'No cases match that.' : 'No cases yet.'}</p>
  {:else}
    <ul class="list cases">
      {#each cases as entry (entry.case_number)}
        <li>
          <span class="tag">#{entry.case_number}</span>
          <span class="badge">{labels[entry.action] ?? entry.action}{entry.duration_ms ? ` · ${formatDuration(entry.duration_ms)}` : ''}</span>
          {#if entry.target_type === 'user'}
            <button class="link" on:click={() => dispatch('member', entry.target_id)} title="Open member history">{target(entry)}</button>
          {:else}
            <span>{target(entry)}</span>
          {/if}
          <span class="grow reason">{entry.reason ?? 'No reason given'}</span>
          <span class="muted meta">by {entry.moderator_tag ?? entry.moderator_id} · {fmtTime(entry.created_at)}</span>
        </li>
      {/each}
    </ul>
    <div class="pagination">
      <button on:click={() => { page = Math.max(1, page - 1); load(); }} disabled={page === 1}>← Prev</button>
      <span>Page {page} of {pages} · {total} case{total === 1 ? '' : 's'}</span>
      <button on:click={() => { page++; load(); }} disabled={page >= pages}>Next →</button>
    </div>
  {/if}
</section>

<style>
  .reason { color: var(--color-text); }
  .meta { font-size: 0.75rem; }
  .link { background: none; border: none; padding: 0; color: var(--color-link); text-decoration: underline; font-size: 0.82rem; }
</style>
