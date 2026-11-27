<script lang="ts">
  import type { guildApi } from '../lib/api';
  import { formatDuration } from '../lib/duration';
  import type { MemberHistory, MemberHit } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let labels: Record<string, string>;
  /** Whose history is open. Set from outside when a case's user is clicked. */
  export let selectedId: string | null = null;

  let query = '';
  let hits: MemberHit[] = [];
  let searched = false;
  let searching = false;
  let history: MemberHistory | null = null;
  let loadingHistory = false;
  let loadedId: string | null = null;

  async function search() {
    if (!query.trim()) return;
    searching = true;
    hits = (await api.get<MemberHit[]>(`moderation/members?q=${encodeURIComponent(query.trim())}`)) ?? [];
    searched = true;
    searching = false;
    // A single exact hit (an ID or mention) opens straight away.
    if (hits.length === 1 && /^\D*\d{16,20}\D*$/.test(query.trim())) selectedId = hits[0].id;
  }

  async function open(id: string) {
    loadedId = id;
    loadingHistory = true;
    const data = await api.get<MemberHistory>(`moderation/members/${id}`);
    // Ignore a slow response for someone the moderator has already clicked away from.
    if (loadedId !== id) return;
    history = data;
    loadingHistory = false;
  }

  $: if (selectedId && selectedId !== loadedId) open(selectedId);

  function fmtDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  $: counts = history
    ? Object.entries(
        history.cases.reduce<Record<string, number>>((acc, entry) => {
          acc[entry.action] = (acc[entry.action] ?? 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1])
    : [];
</script>

<div class="mod-panel">
  <section class="card">
    <h3>🔎 Member lookup</h3>
    <p class="hint">A user ID or mention, or part of a name. People who left or were banned show up if they have cases.</p>
    <form class="add-row" on:submit|preventDefault={search}>
      <input type="search" bind:value={query} placeholder="Name or user ID..." aria-label="Find a member" />
      <button type="submit" class="primary" disabled={searching}>{searching ? 'Searching...' : 'Find'}</button>
    </form>
    {#if searched && !hits.length}
      <p class="empty">Nobody matches that.</p>
    {:else if hits.length}
      <ul class="list">
        {#each hits as hit (hit.id)}
          <li>
            {#if hit.avatar_url}<img class="avatar" src={hit.avatar_url} alt="" />{/if}
            <span class="grow">
              <strong>{hit.display_name ?? hit.tag ?? hit.id}</strong>
              {#if hit.tag && hit.display_name !== hit.tag}<span class="muted"> @{hit.tag}</span>{/if}
            </span>
            {#if !hit.in_server}<span class="badge">not in server</span>{/if}
            <span class="badge">{hit.cases} case{hit.cases === 1 ? '' : 's'}</span>
            <button on:click={() => (selectedId = hit.id)}>Open</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if loadingHistory && !history}
    <p class="empty">Loading history...</p>
  {:else if history}
    <section class="card" class:stale={loadingHistory}>
      <div class="who">
        {#if history.avatar_url}<img class="avatar big" src={history.avatar_url} alt="" />{/if}
        <div class="grow">
          <h3>{history.display_name ?? history.tag ?? history.id}{#if history.bot} <span class="badge">bot</span>{/if}</h3>
          <div class="muted small">@{history.tag ?? 'unknown'} · <code>{history.id}</code></div>
        </div>
      </div>
      <div class="chips status">
        {#if history.ban}
          <span class="badge alert">Banned{history.ban.reason ? `: ${history.ban.reason}` : ''}</span>
        {:else if history.in_server}
          <span class="badge on">In server</span>
        {:else}
          <span class="badge">Not in server</span>
        {/if}
        {#if history.timeout_until}<span class="badge alert">Timed out until {fmtDate(history.timeout_until)}</span>{/if}
        <span class="badge">{history.active_warns} active warn{history.active_warns === 1 ? '' : 's'}{history.warn_expiry_ms ? ` (expire after ${formatDuration(history.warn_expiry_ms)})` : ''}</span>
      </div>
      <div class="row"><span class="label">Account created</span><span>{fmtDate(history.created_at)}</span></div>
      {#if history.in_server}
        <div class="row"><span class="label">Joined</span><span>{fmtDate(history.joined_at)}</span></div>
        {#if history.nickname}<div class="row"><span class="label">Nickname</span><span>{history.nickname}</span></div>{/if}
        <div class="row">
          <span class="label">Roles</span>
          <span class="chips">
            {#each history.roles as role}<span class="chip">@{role.name}</span>{:else}<span class="muted">none</span>{/each}
          </span>
        </div>
      {/if}

      {#if history.scheduled.length}
        <h4>Pending</h4>
        <ul class="list">
          {#each history.scheduled as item (item.id)}
            <li>
              <span class="grow">{item.action === 'unban' ? 'Unban' : `Remove role ${item.role_id}`} on {fmtDate(item.run_at)}</span>
              {#if item.case_number}<span class="tag">#{item.case_number}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}

      <h4>Cases ({history.total_cases})</h4>
      {#if counts.length}
        <div class="chips">
          {#each counts as [key, count]}<span class="chip">{labels[key] ?? key} × {count}</span>{/each}
        </div>
      {/if}
      {#if history.cases.length}
        <ul class="list">
          {#each history.cases as entry (entry.case_number)}
            <li>
              <span class="tag">#{entry.case_number}</span>
              <span class="badge">{labels[entry.action] ?? entry.action}{entry.duration_ms ? ` · ${formatDuration(entry.duration_ms)}` : ''}</span>
              <span class="grow">{entry.reason ?? 'No reason given'}</span>
              <span class="muted small">by {entry.moderator_tag ?? entry.moderator_id} · {fmtDate(entry.created_at)}</span>
            </li>
          {/each}
        </ul>
        {#if history.total_cases > history.cases.length}
          <p class="hint">Showing the newest {history.cases.length}. Search the case browser for older ones.</p>
        {/if}
      {:else}
        <p class="empty">No cases.</p>
      {/if}

      {#if history.notes !== null}
        <h4>Notes ({history.notes.length})</h4>
        {#if history.notes.length}
          <ul class="list">
            {#each history.notes as note (note.id)}
              <li>
                <span class="grow">{note.content}</span>
                <span class="muted small">{note.author_tag ?? note.author_id} · {fmtDate(note.created_at)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">No notes. Add one in Discord with <code>/note add</code>.</p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .avatar { width: 1.6rem; height: 1.6rem; border-radius: 50%; flex-shrink: 0; }
  .avatar.big { width: 3rem; height: 3rem; }
  .who { display: flex; align-items: center; gap: 0.75rem; }
  .who h3 { margin: 0; }
  .status { margin: 0.75rem 0 0.5rem; }
  .small { font-size: 0.75rem; }
  .stale { opacity: 0.6; }
</style>
