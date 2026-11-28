<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { ModOverview } from '../lib/types';
  import Audit from './Audit.svelte';
  import ModAntiRaid from './ModAntiRaid.svelte';
  import ModAutomod from './ModAutomod.svelte';
  import ModCases from './ModCases.svelte';
  import ModLogging from './ModLogging.svelte';
  import ModMember from './ModMember.svelte';
  import ModPanels from './ModPanels.svelte';

  export let api: ReturnType<typeof guildApi>;
  /** Manage Server: the config audit log is admin-only, like the Audit tab. */
  export let admin: boolean;

  type Section = 'cases' | 'members' | 'logging' | 'automod' | 'antiraid' | 'roles' | 'audit';

  let overview: ModOverview | null = null;
  let loading = true;
  let section: Section = 'cases';
  /** Set when a case row's user is clicked, so the member panel opens on them. */
  let memberId: string | null = null;

  const LABELS: Record<Section, string> = {
    cases: '📁 Cases',
    members: '🔎 Member lookup',
    logging: '📋 Logging',
    automod: '🤖 AutoMod',
    antiraid: '🚨 Anti-raid',
    roles: '🧩 Role panels',
    audit: '🧾 Audit'
  };

  const PANELS = ['cases', 'members', 'logging', 'automod', 'antiraid', 'roles'] as const;

  let sections: Section[] = [];
  $: sections = overview ? [...PANELS.filter((key) => overview!.access[key]), ...(admin ? (['audit'] as const) : [])] : [];
  // Losing access mid-session (a role change, a reload) drops you onto a panel you can still use.
  $: if (sections.length && !sections.includes(section)) section = sections[0];

  async function load() {
    loading = true;
    overview = await api.get<ModOverview>('moderation');
    loading = false;
  }

  function openMember(event: CustomEvent<string>) {
    memberId = event.detail;
    section = 'members';
  }

  onMount(load);
</script>

<div class="moderation">
  {#if loading}
    <p class="empty">Loading...</p>
  {:else if !overview}
    <p class="empty">Couldn't load moderation settings.</p>
  {:else}
    <div class="subtabs">
      {#each sections as key}
        <button class:active={section === key} on:click={() => (section = key)}>{LABELS[key]}</button>
      {/each}
    </div>

    {#if section === 'cases'}
      <ModCases {api} labels={overview.action_labels} on:member={openMember} />
    {:else if section === 'members'}
      <ModMember {api} labels={overview.action_labels} bind:selectedId={memberId} />
    {:else if section === 'logging' && overview.logging}
      <ModLogging {api} config={overview.logging} channels={overview.text_channels} modLogChannelId={overview.mod_log_channel_id} />
    {:else if section === 'automod' && overview.automod}
      <ModAutomod {api} config={overview.automod} roles={overview.roles} channels={overview.text_channels} />
    {:else if section === 'antiraid' && overview.antiraid}
      <ModAntiRaid {api} overview={overview.antiraid} roles={overview.roles} channels={overview.text_channels} />
    {:else if section === 'roles' && overview.panels}
      <ModPanels {api} panels={overview.panels} roles={overview.roles} channels={overview.text_channels} />
    {:else if section === 'audit'}
      <Audit {api} fixedSection="moderation" />
    {/if}
  {/if}
</div>

<style>
  /* Shared look for every moderation panel, matching the Config tab. Scoped under .moderation so it can't leak. */
  .moderation { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .subtabs { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .subtabs button { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 0.3rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.15s; }
  .subtabs button.active { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
  .moderation :global(.mod-panel) { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .moderation :global(.card) { background: var(--color-surface); border-radius: 10px; padding: 1rem; min-width: 0; }
  .moderation :global(h3) { margin: 0 0 0.5rem; font-size: 1rem; }
  .moderation :global(h4) { margin: 1rem 0 0.25rem; font-size: 0.9rem; color: var(--color-text-muted); }
  .moderation :global(.row) { display: grid; grid-template-columns: minmax(9rem, 14rem) minmax(0, 1fr); align-items: center; gap: 0.75rem; padding: 0.3rem 0; }
  .moderation :global(.row > label), .moderation :global(.row > .label) { color: var(--color-text-muted); font-size: 0.85rem; }
  .moderation :global(input[type='text']), .moderation :global(input[type='number']), .moderation :global(input[type='search']), .moderation :global(select), .moderation :global(textarea) {
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    min-width: 0;
    font-family: inherit;
  }
  .moderation :global(textarea) { width: 100%; box-sizing: border-box; resize: vertical; font-family: ui-monospace, monospace; }
  .moderation :global(input[type='checkbox']) { accent-color: var(--color-accent); width: 1rem; height: 1rem; justify-self: start; }
  .moderation :global(button) { background: var(--color-surface-sunken); border: 1px solid var(--color-border); color: var(--color-text-muted); padding: 0.35rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.15s; }
  .moderation :global(button:hover:not(:disabled)) { border-color: var(--color-accent); color: var(--color-text); }
  .moderation :global(button:disabled) { opacity: 0.6; cursor: default; }
  .moderation :global(button.primary) { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
  .moderation :global(button.danger:hover:not(:disabled)) { border-color: var(--color-danger, #e5534b); color: var(--color-danger, #e5534b); }
  .moderation :global(.list) { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.35rem; }
  .moderation :global(.list > li) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; background: var(--color-surface-sunken); border-radius: 6px; padding: 0.4rem 0.55rem; font-size: 0.82rem; min-width: 0; }
  .moderation :global(.tag) { color: var(--color-accent-text); font-family: ui-monospace, monospace; flex-shrink: 0; overflow-wrap: anywhere; }
  .moderation :global(.muted) { color: var(--color-text-subtle); }
  .moderation :global(.grow) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .moderation :global(.chip) { display: inline-flex; align-items: center; gap: 0.3rem; background: var(--color-surface-sunken); border: 1px solid var(--color-border); border-radius: 999px; padding: 0.1rem 0.5rem; font-size: 0.78rem; }
  .moderation :global(.chip button) { border: none; background: none; padding: 0 0.15rem; font-size: 0.8rem; line-height: 1; }
  .moderation :global(.chips) { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .moderation :global(.add-row) { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
  .moderation :global(.add-row select), .moderation :global(.add-row input) { flex: 1 1 8rem; }
  .moderation :global(.hint) { color: var(--color-text-subtle); font-size: 0.78rem; margin: 0.35rem 0 0; line-height: 1.45; }
  .moderation :global(.hint code) { font-family: ui-monospace, monospace; }
  .moderation :global(.warn) { color: var(--color-warning, #e0a800); }
  .moderation :global(.empty) { color: var(--color-text-subtle); font-size: 0.85rem; margin: 0.5rem 0 0; }
  .moderation :global(.pagination) { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; font-size: 0.85rem; color: var(--color-text-muted); }
  .moderation :global(.badge) { border: 1px solid var(--color-border); border-radius: 4px; padding: 0.05rem 0.35rem; font-size: 0.72rem; color: var(--color-text-muted); flex-shrink: 0; }
  .moderation :global(.badge.on) { color: var(--color-on-accent); background: var(--color-accent); border-color: var(--color-accent); }
  .moderation :global(.badge.alert) { color: var(--color-danger, #e5534b); border-color: var(--color-danger, #e5534b); }
  @media (max-width: 560px) {
    .moderation :global(.row) { grid-template-columns: minmax(0, 1fr); gap: 0.25rem; }
  }
</style>
