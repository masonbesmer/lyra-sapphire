<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import { pushInfo } from '../lib/toast';
  import type {
    AdminConfig,
    BlacklistEntry,
    BlacklistTargetType,
    CommandPermission,
    MusicConfig,
    StarboardConfig,
    VoiceAssistantConfig,
    WordTrigger
  } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;

  let config: AdminConfig | null = null;
  let loading = true;
  /** Section key of the save currently in flight, so only that button shows a pending state. */
  let saving: string | null = null;

  // Editable copies. Saves write the server's response back over these, so a rejected
  // field never leaves the form displaying a value the database didn't take.
  let music: MusicConfig | null = null;
  let starboard: StarboardConfig | null = null;
  let voice: VoiceAssistantConfig | null = null;
  let blacklist: BlacklistEntry[] = [];
  let permissions: CommandPermission[] = [];
  let triggers: WordTrigger[] = [];

  let blacklistType: BlacklistTargetType = 'channel';
  let blacklistChannelId = '';
  let blacklistUserId = '';

  let permCommand = '';
  let permRoleId = '';

  let triggerKeyword = '';
  let triggerResponse = '';

  async function load() {
    const data = await api.get<AdminConfig>('admin');
    if (data) {
      config = data;
      music = { ...data.music };
      starboard = { ...data.starboard };
      voice = { ...data.voice };
      blacklist = data.starboard_blacklist;
      permissions = data.command_permissions;
      triggers = data.word_triggers;
    }
    loading = false;
  }

  onMount(load);

  async function save<T>(key: string, endpoint: string, body: unknown, apply: (result: T) => void) {
    saving = key;
    const result = await api.patch<T>(endpoint, body);
    saving = null;
    if (!result) return;
    apply(result);
    pushInfo('Saved.');
  }

  const saveMusic = () =>
    music &&
    save<MusicConfig>('music', 'config', music, (result) => {
      music = { ...result };
    });

  const saveStarboard = () =>
    starboard &&
    save<StarboardConfig>('starboard', 'admin/starboard', starboard, (result) => {
      starboard = { ...result };
    });

  const saveVoice = () =>
    voice &&
    save<VoiceAssistantConfig>('voice', 'admin/voice', voice, (result) => {
      voice = { ...result };
    });

  async function mutateBlacklist(action: 'add' | 'remove', target_type: BlacklistTargetType, target_id: string) {
    if (!target_id) return;
    const result = await api.post<BlacklistEntry[]>('admin/starboard-blacklist', { action, target_type, target_id });
    if (!result) return;
    blacklist = result;
    blacklistChannelId = '';
    blacklistUserId = '';
  }

  function addBlacklistEntry() {
    const id = blacklistType === 'channel' ? blacklistChannelId : blacklistUserId.trim();
    return mutateBlacklist('add', blacklistType, id);
  }

  async function mutatePermission(action: 'set' | 'remove', command_name: string, required_role_id?: string) {
    const result = await api.post<CommandPermission[]>('admin/permissions', { action, command_name, required_role_id });
    if (!result) return;
    permissions = result;
    permCommand = '';
    permRoleId = '';
  }

  async function mutateTrigger(action: 'set' | 'remove', keyword: string, response?: string) {
    const result = await api.post<WordTrigger[]>('admin/triggers', { action, keyword, response });
    if (!result) return;
    triggers = result;
    triggerKeyword = '';
    triggerResponse = '';
  }

  function editTrigger(trigger: WordTrigger) {
    triggerKeyword = trigger.keyword;
    triggerResponse = trigger.response;
  }

  function roleName(id: string): string {
    return config?.roles.find((role) => role.id === id)?.name ?? id;
  }
</script>

<div class="config">
  {#if loading}
    <p class="empty">Loading configuration...</p>
  {:else if !config || !music || !starboard || !voice}
    <p class="empty">Couldn't load configuration.</p>
  {:else}
    <section class="card">
      <h3>🎵 Music</h3>
      <div class="row">
        <label for="dj-role">DJ role</label>
        <select id="dj-role" bind:value={music.dj_role_id}>
          <option value={null}>None &mdash; anyone can control playback</option>
          {#each config.roles as role}
            <option value={role.id}>{role.name}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <label for="default-volume">Default volume</label>
        <input id="default-volume" type="number" min="1" max="100" bind:value={music.default_volume} />
      </div>
      <div class="row">
        <label for="announce-tracks">Announce tracks</label>
        <input id="announce-tracks" type="checkbox" bind:checked={music.announce_tracks} />
      </div>
      <div class="row">
        <label for="announce-channel">Announce channel</label>
        <select id="announce-channel" bind:value={music.announce_channel_id}>
          <option value={null}>Wherever /play was run</option>
          {#each config.text_channels as channel}
            <option value={channel.id}>#{channel.name}</option>
          {/each}
        </select>
      </div>
      <button class="save" on:click={saveMusic} disabled={saving === 'music'}>
        {saving === 'music' ? 'Saving...' : 'Save music settings'}
      </button>
    </section>

    <section class="card">
      <h3>⭐ Starboard</h3>
      <div class="row">
        <label for="sb-enabled">Enabled</label>
        <input id="sb-enabled" type="checkbox" bind:checked={starboard.enabled} />
      </div>
      <div class="row">
        <label for="sb-channel">Starboard channel</label>
        <select id="sb-channel" bind:value={starboard.channel_id}>
          <option value={null}>None &mdash; nothing gets posted</option>
          {#each config.text_channels as channel}
            <option value={channel.id}>#{channel.name}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <label for="sb-threshold">Star threshold</label>
        <input id="sb-threshold" type="number" min="1" max="50" bind:value={starboard.threshold} />
      </div>
      <div class="row">
        <label for="sb-emoji">Trigger emoji</label>
        <input id="sb-emoji" type="text" bind:value={starboard.emoji} placeholder="⭐" />
      </div>
      <div class="row">
        <label for="sb-self">Allow self-starring</label>
        <input id="sb-self" type="checkbox" bind:checked={starboard.self_star} />
      </div>
      <button class="save" on:click={saveStarboard} disabled={saving === 'starboard'}>
        {saving === 'starboard' ? 'Saving...' : 'Save starboard settings'}
      </button>

      <h4>Blacklist</h4>
      <p class="hint">Messages in these channels, or from these users, never reach the starboard.</p>
      {#if blacklist.length}
        <ul class="list">
          {#each blacklist as entry}
            <li>
              <span class="tag">{entry.target_type}</span>
              <span class="name">{entry.target_type === 'channel' ? `#${entry.name}` : entry.name}</span>
              <button class="remove" on:click={() => mutateBlacklist('remove', entry.target_type, entry.target_id)}>Remove</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">Nothing blacklisted.</p>
      {/if}
      <div class="add-row">
        <select bind:value={blacklistType} aria-label="Blacklist target type">
          <option value="channel">Channel</option>
          <option value="user">User</option>
        </select>
        {#if blacklistType === 'channel'}
          <select bind:value={blacklistChannelId} aria-label="Channel to blacklist">
            <option value="">Pick a channel...</option>
            {#each config.text_channels as channel}
              <option value={channel.id}>#{channel.name}</option>
            {/each}
          </select>
        {:else}
          <input type="text" bind:value={blacklistUserId} placeholder="User ID" aria-label="User ID to blacklist" />
        {/if}
        <button on:click={addBlacklistEntry}>Add</button>
      </div>
    </section>

    <section class="card">
      <h3>🎧 Voice assistant</h3>
      <div class="row">
        <label for="va-enabled">Enabled</label>
        <input id="va-enabled" type="checkbox" bind:checked={voice.enabled} />
      </div>
      <div class="row">
        <label for="va-wake">Wake word model</label>
        <input id="va-wake" type="text" bind:value={voice.wake_word} />
      </div>
      <div class="row">
        <label for="va-sensitivity">Sensitivity</label>
        <div class="slider">
          <input id="va-sensitivity" type="range" min="0" max="1" step="0.05" bind:value={voice.sensitivity} />
          <span class="value">{voice.sensitivity.toFixed(2)}</span>
        </div>
      </div>
      <div class="row">
        <label for="va-dj">Require DJ role</label>
        <input id="va-dj" type="checkbox" bind:checked={voice.require_dj} />
      </div>
      <div class="row">
        <label for="va-ack">Acknowledgements</label>
        <select id="va-ack" bind:value={voice.ack_mode}>
          <option value="text">Text</option>
          <option value="tts">Spoken</option>
          <option value="none">None</option>
        </select>
      </div>
      <div class="row">
        <label for="va-channel">Text channel</label>
        <select id="va-channel" bind:value={voice.text_channel_id}>
          <option value={null}>Wherever /assistant was started</option>
          {#each config.text_channels as channel}
            <option value={channel.id}>#{channel.name}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <label for="va-silence">Silence timeout (ms)</label>
        <input id="va-silence" type="number" min="100" max="5000" step="50" bind:value={voice.silence_ms} />
      </div>
      <div class="row">
        <label for="va-max">Max utterance (ms)</label>
        <input id="va-max" type="number" min="1000" max="30000" step="500" bind:value={voice.max_utterance_ms} />
      </div>
      <p class="hint">Per-member voice opt-outs stay in Discord under <code>/assistant optout</code> &mdash; they're a personal privacy control, not a server setting.</p>
      <button class="save" on:click={saveVoice} disabled={saving === 'voice'}>
        {saving === 'voice' ? 'Saving...' : 'Save assistant settings'}
      </button>
    </section>

    <section class="card">
      <h3>🔐 Command permissions</h3>
      <p class="hint">Restrict a command to members with a role. Commands not listed here use their built-in permissions.</p>
      {#if permissions.length}
        <ul class="list">
          {#each permissions as perm}
            <li>
              <span class="tag">/{perm.command_name}</span>
              <span class="name">{roleName(perm.required_role_id)}</span>
              <button class="remove" on:click={() => mutatePermission('remove', perm.command_name)}>Remove</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No command restrictions.</p>
      {/if}
      <div class="add-row">
        <select bind:value={permCommand} aria-label="Command to restrict">
          <option value="">Pick a command...</option>
          {#each config.commands as name}
            <option value={name}>{name}</option>
          {/each}
        </select>
        <select bind:value={permRoleId} aria-label="Required role">
          <option value="">Pick a role...</option>
          {#each config.roles as role}
            <option value={role.id}>{role.name}</option>
          {/each}
        </select>
        <button on:click={() => permCommand && permRoleId && mutatePermission('set', permCommand, permRoleId)}>Add</button>
      </div>
    </section>

    <section class="card">
      <h3>💬 Word triggers</h3>
      <p class="hint warn">
        Word triggers are stored globally, not per server &mdash; editing one here changes it in every server Lyra is in.
      </p>
      {#if triggers.length}
        <ul class="list">
          {#each triggers as trigger}
            <li>
              <span class="tag">{trigger.keyword}</span>
              <span class="name response">{trigger.response}</span>
              <button class="remove" on:click={() => editTrigger(trigger)}>Edit</button>
              <button class="remove" on:click={() => mutateTrigger('remove', trigger.keyword)}>Remove</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No word triggers.</p>
      {/if}
      <div class="add-row">
        <input type="text" bind:value={triggerKeyword} placeholder="Keyword" aria-label="Trigger keyword" />
        <input type="text" bind:value={triggerResponse} placeholder="Response" aria-label="Trigger response" />
        <button on:click={() => triggerKeyword && triggerResponse && mutateTrigger('set', triggerKeyword, triggerResponse)}>Save</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .config { display: grid; gap: 1rem; }
  .card { background: #16213e; border-radius: 10px; padding: 1rem; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  h4 { margin: 1.25rem 0 0.25rem; font-size: 0.9rem; color: #a0a0c0; }
  .row { display: grid; grid-template-columns: minmax(9rem, 12rem) 1fr; align-items: center; gap: 0.75rem; padding: 0.35rem 0; }
  .row label { color: #a0a0c0; font-size: 0.85rem; }
  .slider { display: flex; align-items: center; gap: 0.6rem; }
  .slider input { flex: 1; }
  .value { color: #a0a0c0; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  input[type='text'], input[type='number'], select {
    background: #0f0f1e;
    border: 1px solid #2a2a4a;
    color: #e0e0f0;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    min-width: 0;
  }
  input[type='checkbox'] { accent-color: #5865f2; width: 1rem; height: 1rem; justify-self: start; }
  input[type='range'] { accent-color: #5865f2; }
  button { background: #0f0f1e; border: 1px solid #2a2a4a; color: #a0a0c0; padding: 0.35rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.15s; }
  button:hover:not(:disabled) { border-color: #5865f2; color: #e0e0f0; }
  button:disabled { opacity: 0.6; cursor: default; }
  .save { margin-top: 0.85rem; background: #5865f2; border-color: #5865f2; color: white; }
  .list { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.35rem; }
  .list li { display: flex; align-items: center; gap: 0.5rem; background: #0f0f1e; border-radius: 6px; padding: 0.35rem 0.5rem; font-size: 0.82rem; }
  .tag { color: #5865f2; font-family: ui-monospace, monospace; flex-shrink: 0; }
  .name { color: #e0e0f0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .response { color: #a0a0c0; }
  .remove { flex-shrink: 0; padding: 0.2rem 0.55rem; }
  .add-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
  .add-row select, .add-row input { flex: 1 1 8rem; }
  .hint { color: #6a6a8a; font-size: 0.78rem; margin: 0.35rem 0 0; line-height: 1.45; }
  .hint.warn { color: #d9a441; }
  .hint code { font-family: ui-monospace, monospace; }
  .empty { color: #6a6a8a; font-size: 0.85rem; margin: 0.5rem 0 0; }
</style>
