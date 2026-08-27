<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import type { AuditPage, AuditRow, AuditSection } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;

  let rows: AuditRow[] = [];
  /** Sections present for this guild, from the server - the filter never offers an empty one. */
  let sections: AuditSection[] = [];
  let section: AuditSection | '' = '';
  let page = 1;
  let loading = true;

  const PER_PAGE = 25;

  const SECTION_LABELS: Record<AuditSection, string> = {
    music: '🎵 Music',
    starboard: '⭐ Starboard',
    starboard_blacklist: '🚫 Starboard blacklist',
    voice: '🎙️ Voice assistant',
    permissions: '🔑 Command permissions',
    triggers: '💬 Word triggers'
  };

  async function load() {
    loading = true;
    const query = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
    if (section) query.set('section', section);
    const data = await api.get<AuditPage>(`admin/audit?${query}`);
    rows = data?.rows ?? [];
    // Keep the last known section list on a failed request rather than emptying the filter.
    if (data) sections = data.sections;
    loading = false;
  }

  function selectSection(next: AuditSection | '') {
    section = next;
    page = 1;
    load();
  }

  onMount(load);

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /**
   * The blacklist stores its key as `channel:<id>`, which is the wrong thing to show a human.
   * Everything else is already a plain field name or keyword.
   */
  function fmtSetting(row: AuditRow): string {
    if (row.section !== 'starboard_blacklist') return row.setting;
    const [type, id] = row.setting.split(':');
    return `${type} ${id}`;
  }

  /** null means unset. Say so, rather than rendering an empty gap the reader has to guess at. */
  function fmtValue(label: string | null, raw: string | null): string {
    if (raw === null) return 'unset';
    return label ?? raw;
  }
</script>

<div class="audit">
  <h3>🧾 Config Audit</h3>
  <p class="hint">Every change to this server's settings, whether it came from the dashboard or a Discord command.</p>

  <div class="filters">
    <button class:active={section === ''} on:click={() => selectSection('')}>All</button>
    {#each sections as key}
      <button class:active={section === key} on:click={() => selectSection(key)}>{SECTION_LABELS[key] ?? key}</button>
    {/each}
  </div>

  {#if loading}
    <p class="empty">Loading...</p>
  {:else if !rows.length}
    <p class="empty">
      {section ? 'No changes recorded in that section yet.' : 'No config changes recorded yet.'}
    </p>
  {:else}
    <ul class="list">
      {#each rows as row (row.id)}
        <li>
          <div class="head">
            <span class="section">{SECTION_LABELS[row.section] ?? row.section}</span>
            <span class="setting">{fmtSetting(row)}</span>
            <span class="spacer"></span>
            <span class="source" class:discord={row.source === 'discord'}>{row.source}</span>
          </div>
          <div class="change">
            <span class="old" class:unset={row.old_value === null}>{fmtValue(row.old_label, row.old_value)}</span>
            <span class="arrow">→</span>
            <span class="new" class:unset={row.new_value === null}>{fmtValue(row.new_label, row.new_value)}</span>
          </div>
          <div class="meta">
            <span class="actor">{row.actor_name}</span>
            <span>·</span>
            <span>{fmtTime(row.created_at)}</span>
          </div>
        </li>
      {/each}
    </ul>

    <div class="pagination">
      <button on:click={() => { page = Math.max(1, page - 1); load(); }} disabled={page === 1}>← Prev</button>
      <span>Page {page}</span>
      <button on:click={() => { page++; load(); }} disabled={rows.length < PER_PAGE}>Next →</button>
    </div>
  {/if}
</div>

<style>
  .audit { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.35rem; font-size: 1rem; }
  .hint { color: #6a6a8a; font-size: 0.78rem; margin: 0 0 0.75rem; line-height: 1.45; }
  .filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.85rem; }
  .filters button { background: #0f0f1e; border: 1px solid #2a2a4a; color: #a0a0c0; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; transition: all 0.15s; }
  .filters button:hover { border-color: #5865f2; color: #e0e0f0; }
  .filters button.active { background: #5865f2; border-color: #5865f2; color: white; }
  /* minmax(0, 1fr) keeps a long trigger response from stretching the card past the tab. */
  .list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.4rem; max-height: 560px; overflow-y: auto; }
  .list li { background: #0f0f1e; border-radius: 6px; padding: 0.5rem 0.6rem; min-width: 0; }
  .head { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; font-size: 0.78rem; }
  .section { color: #a0a0c0; flex-shrink: 0; }
  .setting { color: #5865f2; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  .spacer { flex: 1; }
  .source { color: #6a6a8a; border: 1px solid #2a2a4a; border-radius: 4px; padding: 0.05rem 0.35rem; font-size: 0.7rem; flex-shrink: 0; }
  .source.discord { color: #a0c4ff; border-color: #33436a; }
  .change { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.3rem; font-size: 0.85rem; }
  .old { color: #8a8aa8; text-decoration: line-through; overflow-wrap: anywhere; }
  .new { color: #e0e0f0; overflow-wrap: anywhere; }
  .unset { color: #6a6a8a; font-style: italic; text-decoration: none; }
  .arrow { color: #6a6a8a; flex-shrink: 0; }
  .meta { margin-top: 0.3rem; display: flex; gap: 0.35rem; color: #6a6a8a; font-size: 0.75rem; }
  .actor { color: #a0a0c0; }
  .empty { color: #6a6a8a; font-size: 0.85rem; margin: 0.5rem 0 0; }
  .pagination { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; font-size: 0.85rem; }
  .pagination button { background: #2a2a4a; border: none; color: #e0e0f0; padding: 0.3rem 0.7rem; border-radius: 4px; cursor: pointer; }
  .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
  .pagination span { color: #a0a0c0; }
</style>
