<script lang="ts">
  import type { guildApi } from '../lib/api';
  import { pushInfo } from '../lib/toast';
  import type { PanelsOverview, RolePanel } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let panels: PanelsOverview;
  export let roles: { id: string; name: string; managed: boolean }[];
  export let channels: { id: string; name: string }[];

  let list: RolePanel[] = panels.list;
  let busy: number | 'new' | null = null;

  const KIND_LABELS: Record<string, string> = { button: 'Buttons', select: 'Select menu', reaction: 'Reactions' };

  // New-panel form.
  let kind: RolePanel['kind'] = 'button';
  let mode: RolePanel['mode'] = 'normal';
  let channelId = '';
  let messageLink = '';
  let title = '';
  let description = '';

  // Per-panel "add a role" rows.
  let entryRole: Record<number, string> = {};
  let entryEmoji: Record<number, string> = {};
  let entryLabel: Record<number, string> = {};

  $: assignable = roles.filter((role) => !role.managed);

  function replace(panel: RolePanel) {
    list = list.map((entry) => (entry.id === panel.id ? panel : entry));
  }

  async function create() {
    busy = 'new';
    const useMessage = kind === 'reaction' && messageLink.trim();
    const panel = await api.post<RolePanel>('moderation/panels', {
      kind,
      mode,
      channel_id: useMessage ? null : channelId || null,
      message_link: useMessage ? messageLink.trim() : null,
      title,
      description
    });
    busy = null;
    if (!panel) return;
    list = [...list, panel];
    title = '';
    description = '';
    messageLink = '';
    pushInfo(`Panel #${panel.id} created. Add roles to it below.`);
  }

  async function addRole(panel: RolePanel) {
    const roleId = entryRole[panel.id];
    if (!roleId) return;
    busy = panel.id;
    const updated = await api.post<RolePanel>(`moderation/panels/${panel.id}/entries`, {
      role_id: roleId,
      emoji: entryEmoji[panel.id] ?? null,
      label: entryLabel[panel.id] ?? null
    });
    busy = null;
    if (!updated) return;
    replace(updated);
    entryRole[panel.id] = '';
    entryEmoji[panel.id] = '';
    entryLabel[panel.id] = '';
  }

  /** Loads an existing entry into the add row, which updates it in place on save. */
  function edit(panel: RolePanel, roleId: string) {
    const entry = panel.entries.find((item) => item.role_id === roleId);
    entryRole[panel.id] = roleId;
    entryEmoji[panel.id] = entry?.emoji ?? '';
    entryLabel[panel.id] = entry?.label ?? '';
  }

  async function removeRole(panel: RolePanel, roleId: string) {
    busy = panel.id;
    const updated = await api.delete<RolePanel>(`moderation/panels/${panel.id}/entries/${roleId}`);
    busy = null;
    if (updated) replace(updated);
  }

  async function setMode(panel: RolePanel, next: string) {
    busy = panel.id;
    const updated = await api.patch<RolePanel>(`moderation/panels/${panel.id}`, { mode: next });
    busy = null;
    if (updated) replace(updated);
  }

  async function remove(panel: RolePanel) {
    const what = panel.owned ? 'and delete its message' : 'and take Lyra’s reactions off the message';
    if (!confirm(`Delete panel #${panel.id} ${what}? Members keep the roles they picked.`)) return;
    busy = panel.id;
    const result = await api.delete<{ ok: boolean }>(`moderation/panels/${panel.id}`);
    busy = null;
    if (result) list = list.filter((entry) => entry.id !== panel.id);
  }
</script>

<div class="mod-panel">
  <section class="card">
    <h3>🧩 New role panel</h3>
    <p class="hint">Members pick their own roles from a panel. Roles with moderator permissions, or above Lyra's top role, can't go on one.</p>
    <div class="row">
      <label for="panel-kind">Style</label>
      <select id="panel-kind" bind:value={kind}>
        {#each panels.kinds as option}<option value={option}>{KIND_LABELS[option] ?? option}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="panel-mode">Mode</label>
      <select id="panel-mode" bind:value={mode}>
        {#each panels.modes as option}<option value={option}>{option}: {panels.mode_hints[option] ?? ''}</option>{/each}
      </select>
    </div>
    {#if kind === 'reaction'}
      <div class="row">
        <label for="panel-link">Use an existing message</label>
        <input id="panel-link" type="text" bind:value={messageLink} placeholder="Message link (optional)" />
      </div>
    {/if}
    {#if !(kind === 'reaction' && messageLink.trim())}
      <div class="row">
        <label for="panel-channel">Post in</label>
        <select id="panel-channel" bind:value={channelId}>
          <option value="">Pick a channel...</option>
          {#each channels as channel}<option value={channel.id}>#{channel.name}</option>{/each}
        </select>
      </div>
      <div class="row">
        <label for="panel-title">Title</label>
        <input id="panel-title" type="text" maxlength="256" bind:value={title} placeholder="Pick your roles" />
      </div>
      <div class="row">
        <label for="panel-description">Description</label>
        <input id="panel-description" type="text" maxlength="1000" bind:value={description} placeholder="Optional" />
      </div>
    {/if}
    <div class="add-row">
      <button class="primary" disabled={busy === 'new' || (!channelId && !(kind === 'reaction' && messageLink.trim()))} on:click={create}>
        {busy === 'new' ? 'Posting...' : 'Create panel'}
      </button>
    </div>
  </section>

  {#each list as panel (panel.id)}
    <section class="card" class:stale={busy === panel.id}>
      <div class="head">
        <strong class="tag">#{panel.id}</strong>
        <span class="grow">{panel.title ?? 'Pick your roles'}</span>
        <span class="badge">{KIND_LABELS[panel.kind] ?? panel.kind}</span>
        <a href={panel.url} target="_blank" rel="noopener noreferrer">#{panel.channel_name ?? panel.channel_id} ↗</a>
      </div>
      <div class="row">
        <label for="mode-{panel.id}">Mode</label>
        <select id="mode-{panel.id}" value={panel.mode} disabled={busy === panel.id} on:change={(e) => setMode(panel, e.currentTarget.value)}>
          {#each panels.modes as option}<option value={option}>{option}: {panels.mode_hints[option] ?? ''}</option>{/each}
        </select>
      </div>
      {#if panel.entries.length}
        <ul class="list">
          {#each panel.entries as entry (entry.role_id)}
            <li>
              {#if entry.emoji}<span>{entry.emoji}</span>{/if}
              <span class="grow">@{entry.role_name ?? 'deleted role'}{entry.label ? ` — ${entry.label}` : ''}</span>
              <button disabled={busy === panel.id} on:click={() => edit(panel, entry.role_id)}>Edit</button>
              <button class="danger" disabled={busy === panel.id} on:click={() => removeRole(panel, entry.role_id)}>Remove</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No roles yet.</p>
      {/if}
      <form class="add-row" on:submit|preventDefault={() => addRole(panel)}>
        <select bind:value={entryRole[panel.id]} aria-label="Role to add">
          <option value="">Pick a role...</option>
          {#each assignable as role}<option value={role.id}>@{role.name}</option>{/each}
        </select>
        <input type="text" bind:value={entryEmoji[panel.id]} placeholder={panel.kind === 'reaction' ? 'Emoji (required)' : 'Emoji (optional)'} aria-label="Emoji" />
        {#if panel.kind !== 'reaction'}
          <input type="text" maxlength="80" bind:value={entryLabel[panel.id]} placeholder="Label (optional)" aria-label="Label" />
        {/if}
        <button type="submit" disabled={busy === panel.id || !entryRole[panel.id]}>
          {panel.entries.some((entry) => entry.role_id === entryRole[panel.id]) ? 'Update' : 'Add role'}
        </button>
      </form>
      <p class="hint">Custom emoji go in as <code>&lt;:name:id&gt;</code>.</p>
      <div class="add-row">
        <button class="danger" disabled={busy === panel.id} on:click={() => remove(panel)}>Delete panel</button>
      </div>
    </section>
  {:else}
    <section class="card"><p class="empty">No role panels yet.</p></section>
  {/each}
</div>

<style>
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
  .head a { color: var(--color-link); font-size: 0.8rem; }
  .stale { opacity: 0.6; }
</style>
