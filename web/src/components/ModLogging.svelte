<script lang="ts">
  import type { guildApi } from '../lib/api';
  import { pushInfo } from '../lib/toast';
  import type { LoggingConfig, LogIgnores } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let config: LoggingConfig;
  export let channels: { id: string; name: string }[];
  export let modLogChannelId: string | null;

  let routes = { ...config.routes };
  let ignores: LogIgnores = { channel: [...config.ignores.channel], user: [...config.ignores.user] };
  let saving = false;
  let ignoreChannelId = '';
  let ignoreUserId = '';

  const GROUP_LABELS: Record<string, string> = { messages: '💬 Messages', members: '👥 Members', voice: '🔊 Voice', server: '🏠 Server' };

  function channelName(id: string | undefined | null): string {
    if (!id) return 'off';
    return `#${channels.find((channel) => channel.id === id)?.name ?? id}`;
  }

  async function patch(body: unknown) {
    saving = true;
    const result = await api.patch<{ routes: LoggingConfig['routes']; ignores: LogIgnores }>('moderation/logging', body);
    saving = false;
    if (!result) return false;
    routes = result.routes;
    ignores = result.ignores;
    pushInfo('Saved.');
    return true;
  }

  function setRoute(event: string, channelId: string) {
    return patch({ routes: { [event]: channelId || null } });
  }

  function setGroup(events: readonly string[], channelId: string) {
    if (channelId === '__keep') return;
    return patch({ routes: Object.fromEntries(events.map((event) => [event, channelId || null])) });
  }

  /** The group's channel when every event in it goes to the same place, so the group picker can show it. */
  function groupValue(events: readonly string[], current: typeof routes): string {
    const values = new Set(events.map((event) => current[event] ?? ''));
    return values.size === 1 ? [...values][0] : '__keep';
  }

  async function ignore(type: 'channel' | 'user', id: string, ignored: boolean) {
    const clean = id.trim().replace(/\D/g, '');
    if (!clean) return;
    if (await patch({ ignore: { type, id: clean, ignored } })) {
      ignoreChannelId = '';
      ignoreUserId = '';
    }
  }
</script>

<div class="mod-panel">
  <section class="card">
    <h3>📋 Event logging</h3>
    <p class="hint">
      Pick a channel for each event, or a whole group at once. Lyra needs View Channel, Send Messages, Embed Links and Attach Files there.
      Mod actions (and bans, kicks and timeouts done outside Lyra) go to the mod log: <strong>{channelName(modLogChannelId)}</strong>
      (<code>/modconfig log-channel</code>).
    </p>
    {#each Object.entries(config.groups) as [group, events]}
      <h4>{GROUP_LABELS[group] ?? group}</h4>
      <div class="row">
        <label for="group-{group}">Whole group</label>
        <select id="group-{group}" value={groupValue(events, routes)} disabled={saving} on:change={(e) => setGroup(events, e.currentTarget.value)}>
          <option value="__keep" disabled>Mixed</option>
          <option value="">Off</option>
          {#each channels as channel}<option value={channel.id}>#{channel.name}</option>{/each}
        </select>
      </div>
      {#each events as event}
        <div class="row">
          <label for="log-{event}">{config.labels[event] ?? event}</label>
          <select id="log-{event}" value={routes[event] ?? ''} disabled={saving} on:change={(e) => setRoute(event, e.currentTarget.value)}>
            <option value="">Off</option>
            {#if routes[event] && !channels.some((channel) => channel.id === routes[event])}
              <option value={routes[event]}>{routes[event]} (missing)</option>
            {/if}
            {#each channels as channel}<option value={channel.id}>#{channel.name}</option>{/each}
          </select>
        </div>
      {/each}
    {/each}
  </section>

  <section class="card">
    <h3>🙈 Ignored</h3>
    <p class="hint">Nothing from these channels (or the channels in an ignored category) or users is logged.</p>
    <h4>Channels</h4>
    <div class="chips">
      {#each ignores.channel as id}
        <span class="chip">{channelName(id)}<button title="Stop ignoring" on:click={() => ignore('channel', id, false)}>✕</button></span>
      {:else}
        <span class="muted">none</span>
      {/each}
    </div>
    <div class="add-row">
      <select bind:value={ignoreChannelId} aria-label="Channel to ignore">
        <option value="">Pick a channel...</option>
        {#each channels.filter((channel) => !ignores.channel.includes(channel.id)) as channel}<option value={channel.id}>#{channel.name}</option>{/each}
      </select>
      <button on:click={() => ignore('channel', ignoreChannelId, true)} disabled={!ignoreChannelId || saving}>Ignore</button>
    </div>
    <p class="hint">To ignore a category, use <code>/logconfig ignore</code> in Discord.</p>
    <h4>Users</h4>
    <div class="chips">
      {#each ignores.user as id}
        <span class="chip"><code>{id}</code><button title="Stop ignoring" on:click={() => ignore('user', id, false)}>✕</button></span>
      {:else}
        <span class="muted">none</span>
      {/each}
    </div>
    <form class="add-row" on:submit|preventDefault={() => ignore('user', ignoreUserId, true)}>
      <input type="text" bind:value={ignoreUserId} placeholder="User ID" aria-label="User ID to ignore" />
      <button type="submit" disabled={!ignoreUserId.trim() || saving}>Ignore</button>
    </form>
  </section>
</div>
