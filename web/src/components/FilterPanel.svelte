<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { FiltersResponse } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;

  let available: string[] = [];
  let active = new Set<string>();
  let loading = true;

  async function load() {
    const data = await api.get<FiltersResponse>('filters');
    available = data?.available ?? [];
    active = new Set(data?.active ?? []);
    loading = false;
  }

  onMount(load);

  async function toggle(name: string) {
    const data = await api.post<{ active: string[] }>('filters', { filter: name });
    if (data) active = new Set(data.active);
  }
</script>

<div class="filters">
  <h3>🎛️ Filters</h3>
  {#if loading}
    <p class="empty">Loading...</p>
  {:else if !available.length}
    <p class="empty">No player active.</p>
  {:else}
    <div class="grid">
      {#each available as name}
        <button class:active={active.has(name)} on:click={() => toggle(name)}>{name}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .filters { background: var(--color-surface); border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  .grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .grid button { background: var(--color-surface-sunken); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 0.35rem 0.8rem; border-radius: 20px; cursor: pointer; font-size: 0.8rem; transition: all 0.15s; }
  .grid button:hover { border-color: var(--color-accent); }
  .grid button.active { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); }
  .empty { color: var(--color-text-subtle); font-size: 0.9rem; }
</style>
