<script lang="ts">
  import type { guildApi } from '../lib/api';
  import { formatDuration, parseDuration } from '../lib/duration';
  import { pushError, pushInfo } from '../lib/toast';
  import type { AutomodConfig, AutomodRule, AutomodSettings } from '../lib/types';
  import IdChips from './IdChips.svelte';

  export let api: ReturnType<typeof guildApi>;
  export let config: AutomodConfig;
  export let roles: { id: string; name: string }[];
  export let channels: { id: string; name: string }[];

  /** Editable copy of one filter; text fields hold what the moderator typed until they save. */
  interface Draft {
    enabled: boolean;
    action: string;
    duration: string;
    limit: number | null;
    window: string;
    mode: 'block' | 'allow';
    list: string;
    exemptRoles: string[];
    exemptChannels: string[];
  }

  let rules: AutomodRule[] = config.rules;
  let settings: AutomodSettings = config.settings;
  let drafts: Record<string, Draft> = Object.fromEntries(rules.map((rule) => [rule.rule, toDraft(rule)]));
  let globalRoles = [...settings.exemptRoles];
  let globalChannels = [...settings.exemptChannels];
  let open: string | null = null;
  let saving: string | null = null;

  const ACTION_LABELS: Record<string, string> = { log: 'Log only', delete: 'Delete', warn: 'Delete + warn', timeout: 'Delete + timeout', kick: 'Delete + kick', ban: 'Delete + ban' };

  function listOf(rule: AutomodRule): string[] {
    const key = config.list_keys[rule.rule];
    return key ? ((rule.settings[key] as string[] | undefined) ?? []) : [];
  }

  function toDraft(rule: AutomodRule): Draft {
    return {
      enabled: rule.enabled,
      action: rule.action,
      duration: formatDuration(rule.durationMs),
      limit: rule.settings.limit ?? null,
      window: formatDuration(rule.settings.windowMs),
      mode: rule.settings.mode ?? 'block',
      list: listOf(rule).join('\n'),
      exemptRoles: [...rule.exemptRoles],
      exemptChannels: [...rule.exemptChannels]
    };
  }

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((entry, index) => entry === b[index]);

  /** Only the fields that changed, so a save can't trip a check on a value nobody touched. */
  function diff(rule: AutomodRule, draft: Draft): Record<string, unknown> | null {
    const body: Record<string, unknown> = {};
    if (draft.enabled !== rule.enabled) body.enabled = draft.enabled;
    if (draft.action !== rule.action) body.action = draft.action;
    const duration = draft.duration.trim() ? parseDuration(draft.duration) : null;
    if (draft.duration.trim() && duration === null) {
      pushError(`"${draft.duration}" isn't a duration. Try 10m, 1h or 7d.`);
      return null;
    }
    if (duration !== rule.durationMs) body.duration_ms = duration;
    const limits = config.limits[rule.rule];
    if (limits && draft.limit !== null && draft.limit !== (rule.settings.limit ?? null)) body.limit = draft.limit;
    if (limits?.window) {
      const window = parseDuration(draft.window);
      if (window === null) {
        pushError(`"${draft.window}" isn't a time window. Try 5s or 30s.`);
        return null;
      }
      if (window !== rule.settings.windowMs) body.window_ms = window;
    }
    if (rule.rule === 'links' && draft.mode !== (rule.settings.mode ?? 'block')) body.mode = draft.mode;
    if (config.list_keys[rule.rule]) {
      const list = draft.list.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!same(list, listOf(rule))) body.list = list;
    }
    if (!same(draft.exemptRoles, rule.exemptRoles)) body.exempt_roles = draft.exemptRoles;
    if (!same(draft.exemptChannels, rule.exemptChannels)) body.exempt_channels = draft.exemptChannels;
    return body;
  }

  async function saveRule(rule: AutomodRule, overrides: Partial<Draft> = {}) {
    const draft = { ...drafts[rule.rule], ...overrides };
    const body = diff(rule, draft);
    if (!body) return;
    if (!Object.keys(body).length) return pushInfo('Nothing changed.');
    saving = rule.rule;
    const result = await api.patch<{ rule: AutomodRule; warning: string | null }>('moderation/automod', { rule: rule.rule, ...body });
    saving = null;
    if (!result) return;
    rules = rules.map((entry) => (entry.rule === result.rule.rule ? result.rule : entry));
    drafts[rule.rule] = toDraft(result.rule);
    if (result.warning) pushError(result.warning);
    else pushInfo('Saved.');
  }

  /** The on/off switch saves straight away, keeping any other unsaved edits in the draft. */
  async function toggle(rule: AutomodRule) {
    const enabled = !rule.enabled;
    saving = rule.rule;
    const result = await api.patch<{ rule: AutomodRule; warning: string | null }>('moderation/automod', { rule: rule.rule, enabled });
    saving = null;
    if (!result) return;
    rules = rules.map((entry) => (entry.rule === result.rule.rule ? result.rule : entry));
    drafts[rule.rule] = { ...drafts[rule.rule], enabled: result.rule.enabled };
    if (result.warning) pushError(result.warning);
  }

  async function saveGlobal(body: Record<string, unknown>) {
    saving = 'global';
    const result = await api.patch<{ settings: AutomodSettings; warning: string | null }>('moderation/automod', { global: body });
    saving = null;
    if (!result) return;
    settings = result.settings;
    globalRoles = [...settings.exemptRoles];
    globalChannels = [...settings.exemptChannels];
    if (result.warning) pushError(result.warning);
    else pushInfo('Saved.');
  }

  function describe(rule: AutomodRule): string {
    const action = ACTION_LABELS[rule.action] ?? rule.action;
    const duration = (rule.action === 'timeout' || rule.action === 'ban') && rule.durationMs ? ` ${formatDuration(rule.durationMs)}` : '';
    return `${action}${duration}`;
  }
</script>

<div class="mod-panel">
  <section class="card">
    <h3>🤖 AutoMod</h3>
    <p class="hint">Owners and administrators are never filtered. Every hit is posted to the mod log.</p>
    <div class="row">
      <label for="native-sync">Mirror into Discord's native AutoMod</label>
      <input id="native-sync" type="checkbox" checked={settings.nativeSync} disabled={saving === 'global'} on:change={(e) => saveGlobal({ native_sync: e.currentTarget.checked })} />
    </div>
    <p class="hint">Native rules block banned words, mention spam and spam before the message is ever posted. Lyra needs Manage Server for this.</p>
    <h4>Exempt everywhere</h4>
    <div class="row"><span class="label">Roles</span><IdChips items={roles} bind:selected={globalRoles} prefix="@" placeholder="Add a role..." /></div>
    <div class="row"><span class="label">Channels</span><IdChips items={channels} bind:selected={globalChannels} prefix="#" placeholder="Add a channel..." /></div>
    <button class="primary" disabled={saving === 'global' || (same(globalRoles, settings.exemptRoles) && same(globalChannels, settings.exemptChannels))} on:click={() => saveGlobal({ exempt_roles: globalRoles, exempt_channels: globalChannels })}>Save exemptions</button>
  </section>

  {#each rules as rule (rule.rule)}
    {@const draft = drafts[rule.rule]}
    {@const limits = config.limits[rule.rule]}
    {@const listKey = config.list_keys[rule.rule]}
    <section class="card">
      <div class="head">
        <input type="checkbox" checked={rule.enabled} disabled={saving === rule.rule} on:change={() => toggle(rule)} aria-label="Turn {rule.rule} on or off" />
        <strong class="tag">{rule.rule}</strong>
        <span class="grow muted">{config.descriptions[rule.rule] ?? ''}</span>
        <span class="badge" class:on={rule.enabled}>{rule.enabled ? describe(rule) : 'off'}</span>
        <button on:click={() => (open = open === rule.rule ? null : rule.rule)}>{open === rule.rule ? 'Close' : 'Edit'}</button>
      </div>

      {#if open === rule.rule}
        <div class="body">
          <div class="row">
            <label for="action-{rule.rule}">Action</label>
            <select id="action-{rule.rule}" bind:value={drafts[rule.rule].action}>
              {#each config.actions as action}<option value={action}>{ACTION_LABELS[action] ?? action}</option>{/each}
            </select>
          </div>
          {#if draft.action === 'timeout' || draft.action === 'ban'}
            <div class="row">
              <label for="duration-{rule.rule}">{draft.action === 'timeout' ? 'Timeout length' : 'Ban length'}</label>
              <input id="duration-{rule.rule}" type="text" bind:value={drafts[rule.rule].duration} placeholder={draft.action === 'timeout' ? '10m (default)' : 'empty = permanent'} />
            </div>
          {/if}
          {#if limits}
            <div class="row">
              <label for="limit-{rule.rule}">Limit ({limits.label})</label>
              <input id="limit-{rule.rule}" type="number" min={limits.limit[0]} max={limits.limit[1]} bind:value={drafts[rule.rule].limit} />
            </div>
            {#if limits.window}
              <div class="row">
                <label for="window-{rule.rule}">Within</label>
                <input id="window-{rule.rule}" type="text" bind:value={drafts[rule.rule].window} placeholder="e.g. 5s, 30s" />
              </div>
            {/if}
          {/if}
          {#if rule.rule === 'links'}
            <div class="row">
              <label for="mode-{rule.rule}">Mode</label>
              <select id="mode-{rule.rule}" bind:value={drafts[rule.rule].mode}>
                <option value="block">Block the listed domains</option>
                <option value="allow">Allow only the listed domains</option>
              </select>
            </div>
          {/if}
          {#if listKey}
            <h4>{listKey === 'words' ? 'Banned words' : listKey === 'allow' ? 'Allowed invite codes' : listKey === 'extensions' ? 'Blocked file types' : rule.rule === 'phishing' ? 'Extra phishing domains' : 'Domains'}</h4>
            <textarea rows="5" bind:value={drafts[rule.rule].list} aria-label="{rule.rule} list"></textarea>
            <p class="hint">
              One per line.
              {#if listKey === 'words'}Plain words match whole words (<code>*</code> is a wildcard); <code>/regex/</code> works too.{/if}
              {#if listKey === 'extensions'}Without the dot, e.g. <code>exe</code>.{/if}
            </p>
          {/if}
          <h4>Exempt from this filter</h4>
          <div class="row"><span class="label">Roles</span><IdChips items={roles} bind:selected={drafts[rule.rule].exemptRoles} prefix="@" placeholder="Add a role..." /></div>
          <div class="row"><span class="label">Channels</span><IdChips items={channels} bind:selected={drafts[rule.rule].exemptChannels} prefix="#" placeholder="Add a channel..." /></div>
          <div class="add-row">
            <button class="primary" disabled={saving === rule.rule} on:click={() => saveRule(rule)}>{saving === rule.rule ? 'Saving...' : 'Save'}</button>
            <button on:click={() => (drafts[rule.rule] = toDraft(rule))}>Reset</button>
          </div>
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
  .head .grow { font-size: 0.8rem; }
  .body { margin-top: 0.75rem; }
</style>
