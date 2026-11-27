<script lang="ts">
  import type { guildApi } from '../lib/api';
  import { formatDuration, parseDuration } from '../lib/duration';
  import { pushError, pushInfo } from '../lib/toast';
  import type { AntiRaidConfig, AntiRaidOverview, AntiRaidSettings } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let overview: AntiRaidOverview;
  export let roles: { id: string; name: string; managed: boolean }[];
  export let channels: { id: string; name: string }[];

  let config: AntiRaidConfig = overview.config;
  let raidActive = overview.raid_active;
  let form = toForm(config);
  let saving = false;

  const ACTION_LABELS: Record<string, string> = { none: 'Let them in', quarantine: 'Quarantine', kick: 'Kick', ban: 'Ban' };

  function toForm(source: AntiRaidConfig) {
    return {
      ...source,
      join_window: formatDuration(source.join_window_ms),
      raid_duration: formatDuration(source.raid_duration_ms),
      min_account_age: formatDuration(source.min_account_age_ms)
    };
  }

  const DURATIONS = [
    ['join_window', 'join_window_ms', 'Join window'],
    ['raid_duration', 'raid_duration_ms', 'Raid mode length'],
    ['min_account_age', 'min_account_age_ms', 'Minimum account age']
  ] as const;

  const FIELDS: (keyof AntiRaidSettings)[] = [
    'enabled',
    'join_threshold',
    'raid_lockdown',
    'raid_join_action',
    'alert_channel_id',
    'alert_role_id',
    'account_age_action',
    'default_avatar_action',
    'quarantine_role_id',
    'quarantine_on_join',
    'verify_role_id',
    'verify_mode'
  ];

  async function save() {
    const body: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const value = form[field] === '' ? null : form[field];
      if (value !== config[field]) body[field] = value;
    }
    for (const [text, field, label] of DURATIONS) {
      const raw = form[text].trim();
      // Account age 0 (off) is the one duration that can be empty.
      const ms = raw ? parseDuration(raw) : field === 'min_account_age_ms' ? 0 : null;
      if (ms === null) return pushError(`${label}: "${raw}" isn't a duration. Try 10s, 15m or 7d.`);
      if (ms !== config[field]) body[field] = ms;
    }
    if (!Object.keys(body).length) return pushInfo('Nothing changed.');
    saving = true;
    const result = await api.patch<{ config: AntiRaidConfig; raid_active: boolean }>('moderation/antiraid', body);
    saving = false;
    if (!result) return;
    config = result.config;
    raidActive = result.raid_active;
    form = toForm(config);
    pushInfo('Saved.');
  }

  $: assignable = roles.filter((role) => !role.managed);
</script>

<div class="mod-panel">
  <section class="card">
    <h3>🚨 Anti-raid</h3>
    {#if raidActive}
      <p class="hint warn">
        Raid mode is on until {new Date(config.raid_until ?? '').toLocaleTimeString()} ({config.raid_join_count} joins caught).
        End it early with <code>/antiraid end</code>.
      </p>
    {/if}
    <div class="row">
      <label for="ar-enabled">Watch for raids</label>
      <input id="ar-enabled" type="checkbox" bind:checked={form.enabled} />
    </div>
    <div class="row">
      <label for="ar-threshold">Raid = this many joins</label>
      <input id="ar-threshold" type="number" min="3" max="100" bind:value={form.join_threshold} />
    </div>
    <div class="row">
      <label for="ar-window">...within</label>
      <input id="ar-window" type="text" bind:value={form.join_window} placeholder="10s" />
    </div>
    <h4>During a raid</h4>
    <div class="row">
      <label for="ar-lockdown">Lock every channel</label>
      <input id="ar-lockdown" type="checkbox" bind:checked={form.raid_lockdown} />
    </div>
    <div class="row">
      <label for="ar-join-action">New joins</label>
      <select id="ar-join-action" bind:value={form.raid_join_action}>
        {#each overview.join_actions as action}<option value={action}>{ACTION_LABELS[action] ?? action}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="ar-duration">Raid mode lasts</label>
      <input id="ar-duration" type="text" bind:value={form.raid_duration} placeholder="15m" />
    </div>
    <div class="row">
      <label for="ar-alert-channel">Alert channel</label>
      <select id="ar-alert-channel" bind:value={form.alert_channel_id}>
        <option value={null}>None</option>
        {#each channels as channel}<option value={channel.id}>#{channel.name}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="ar-alert-role">Ping on alert</label>
      <select id="ar-alert-role" bind:value={form.alert_role_id}>
        <option value={null}>Nobody</option>
        {#each roles as role}<option value={role.id}>@{role.name}</option>{/each}
      </select>
    </div>
  </section>

  <section class="card">
    <h3>🚪 Join gating</h3>
    <p class="hint">Checks every join, raid or not.</p>
    <div class="row">
      <label for="ar-age">Minimum account age</label>
      <input id="ar-age" type="text" bind:value={form.min_account_age} placeholder="empty = off, e.g. 7d" />
    </div>
    <div class="row">
      <label for="ar-age-action">Younger accounts</label>
      <select id="ar-age-action" bind:value={form.account_age_action}>
        {#each overview.join_actions as action}<option value={action}>{ACTION_LABELS[action] ?? action}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="ar-avatar-action">No profile picture</label>
      <select id="ar-avatar-action" bind:value={form.default_avatar_action}>
        {#each overview.join_actions as action}<option value={action}>{ACTION_LABELS[action] ?? action}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="ar-quarantine-role">Quarantine role</label>
      <select id="ar-quarantine-role" bind:value={form.quarantine_role_id}>
        <option value={null}>None</option>
        {#each assignable as role}<option value={role.id}>@{role.name}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="ar-quarantine-all">Quarantine every new member</label>
      <input id="ar-quarantine-all" type="checkbox" bind:checked={form.quarantine_on_join} />
    </div>
    <h4>Verification</h4>
    <div class="row">
      <label for="ar-verify-role">Role granted on verify</label>
      <select id="ar-verify-role" bind:value={form.verify_role_id}>
        <option value={null}>None (just lift quarantine)</option>
        {#each assignable as role}<option value={role.id}>@{role.name}</option>{/each}
      </select>
    </div>
    <div class="row">
      <label for="ar-verify-mode">Verify with</label>
      <select id="ar-verify-mode" bind:value={form.verify_mode}>
        {#each overview.verify_modes as mode}<option value={mode}>{mode === 'captcha' ? 'A captcha' : 'A button'}</option>{/each}
      </select>
    </div>
    <p class="hint">Post the verify button in a channel with <code>/antiraid verification</code>.</p>
    <div class="add-row">
      <button class="primary" disabled={saving} on:click={save}>{saving ? 'Saving...' : 'Save anti-raid settings'}</button>
      <button on:click={() => (form = toForm(config))}>Reset</button>
    </div>
  </section>
</div>
