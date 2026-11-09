<script lang="ts">
  import { onMount } from 'svelte';
  import type { guildApi } from '../lib/api';
  import { queue, voiceState } from '../lib/stores';
  import { pushError, pushInfo } from '../lib/toast';
  import { addNowPlaying, formatLength, MAX_COVER_BYTES, MAX_REPEAT } from '../lib/playlists';
  import type { PlaylistDetail, PlaylistGrant, PlaylistTrack } from '../lib/types';

  export let api: ReturnType<typeof guildApi>;
  export let playlistId: number;
  export let onBack: () => void;

  type Flags = Pick<PlaylistGrant, 'create' | 'read' | 'update' | 'delete'>;
  const FLAGS: { key: keyof Flags; label: string; hint: string }[] = [
    { key: 'read', label: 'R', hint: 'View and play' },
    { key: 'create', label: 'C', hint: 'Add tracks' },
    { key: 'update', label: 'U', hint: 'Reorder, rename, change the cover' },
    { key: 'delete', label: 'D', hint: 'Remove tracks' }
  ];

  let detail: PlaylistDetail | null = null;
  let busy = false;

  let editName = '';
  let editDescription = '';

  let shuffle = false;
  let loop = false;
  let repeat = 1;

  let query = '';

  let granteeInput = '';
  let newFlags: Flags = { read: true, create: false, update: false, delete: false };

  let coverInput: HTMLInputElement;

  $: path = `playlists/${playlistId}`;
  $: access = detail?.access;
  $: voiceChannelId = $voiceState?.channelId ?? null;

  async function load() {
    detail = await api.get<PlaylistDetail>(path);
    if (!detail) onBack();
  }

  /** Separate from load, so reloading after a reorder never discards an unsaved rename. */
  function resetEdits() {
    editName = detail?.name ?? '';
    editDescription = detail?.description ?? '';
  }

  /** Runs one mutation, then re-reads the playlist so positions and counts come from the server. */
  async function act<T>(run: () => Promise<T | null>, success?: string): Promise<T | null> {
    busy = true;
    try {
      const res = await run();
      if (res && success) pushInfo(success);
      await load();
      return res;
    } finally {
      busy = false;
    }
  }

  async function saveDetails() {
    if (await act(() => api.patch(path, { name: editName, description: editDescription || null }), 'Saved')) resetEdits();
  }

  function setPublic(isPublic: boolean) {
    return act(() => api.patch(path, { isPublic }), isPublic ? 'Playlist is now public' : 'Playlist is now private');
  }

  function move(track: PlaylistTrack, by: number) {
    return act(() => api.post(`${path}/reorder`, { from: track.position, to: track.position + by }));
  }

  function remove(track: PlaylistTrack) {
    return act(() => api.delete(`${path}/tracks/${track.id}`), `Removed ${track.title}`);
  }

  async function addByQuery() {
    const q = query.trim();
    if (!q) return;
    const res = await act(() => api.post<{ ok: true; added: number }>(`${path}/tracks`, { query: q }));
    if (!res) return;
    pushInfo(res.added === 1 ? 'Added 1 track' : `Added ${res.added} tracks`);
    query = '';
  }

  function saveNowPlaying() {
    return act(async () => ((await addNowPlaying(api, detail!)) ? true : null));
  }

  function play() {
    if (!voiceChannelId) return;
    const channelId = voiceChannelId;
    return act(
      () => api.post<{ ok: true; queued: number }>(`${path}/enqueue`, { channelId, shuffle, loop, repeat }),
      `Queued ${detail?.name}`
    );
  }

  function uploadCover(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    coverInput.value = '';
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) return pushError('Covers can be at most 1 MiB.');
    return act(() => api.upload(`${path}/cover`, file), 'Cover updated');
  }

  function removeCover() {
    return act(() => api.delete(`${path}/cover`), 'Cover removed');
  }

  async function grant() {
    const user = granteeInput.trim();
    if (!user) return;
    const res = await act(() => api.post(`${path}/grants`, { user, ...newFlags }), 'Access granted');
    if (!res) return;
    granteeInput = '';
    newFlags = { read: true, create: false, update: false, delete: false };
  }

  function toggleGrant(existing: PlaylistGrant, key: keyof Flags) {
    const flags: Flags = { read: existing.read, create: existing.create, update: existing.update, delete: existing.delete };
    flags[key] = !flags[key];
    return act(() => api.post(`${path}/grants`, { user: existing.userId, ...flags }));
  }

  function revoke(existing: PlaylistGrant) {
    return act(() => api.delete(`${path}/grants/${existing.userId}`), `Revoked ${existing.username}'s access`);
  }

  async function deletePlaylist() {
    if (!detail || !confirm(`Delete ${detail.name} and all its tracks? This can't be undone.`)) return;
    busy = true;
    const res = await api.delete(path);
    busy = false;
    if (!res) return;
    pushInfo(`Deleted ${detail.name}`);
    onBack();
  }

  onMount(async () => {
    await load();
    resetEdits();
  });
</script>

<div class="detail">
  <button class="back" on:click={onBack}>← All playlists</button>

  {#if !detail || !access}
    <p class="empty">Loading...</p>
  {:else}
    <header>
      {#if detail.coverUrl}
        <img class="cover" src={detail.coverUrl} alt="" />
      {:else}
        <span class="cover placeholder">🎵</span>
      {/if}
      <div>
        <h3>{detail.name}{#if detail.isPublic}<span class="badge">public</span>{/if}</h3>
        {#if detail.description}<p class="description">{detail.description}</p>{/if}
        <p class="meta">
          by {detail.owner.username} • {detail.trackCount} tracks{#if detail.totalLengthMs} • {formatLength(detail.totalLengthMs)}{/if}
        </p>
      </div>
    </header>

    <section class="play">
      <label><input type="checkbox" bind:checked={shuffle} /> Shuffle</label>
      <label title="Loops the whole queue, as /loop queue does - needs the DJ role"><input type="checkbox" bind:checked={loop} /> Loop</label>
      <label>Repeat <input type="number" min="1" max={MAX_REPEAT} bind:value={repeat} /></label>
      <button class="primary" on:click={play} disabled={busy || !voiceChannelId || !detail.trackCount}>▶ Play</button>
      {#if !voiceChannelId}<span class="hint">Join a voice channel to play it.</span>{/if}
    </section>

    {#if access.create}
      <section class="add">
        <form on:submit|preventDefault={addByQuery}>
          <input bind:value={query} placeholder="Add a song or paste a link..." />
          <button type="submit" disabled={busy || !query.trim()}>Add</button>
        </form>
        {#if $queue?.current}
          <button on:click={saveNowPlaying} disabled={busy}>+ Now playing</button>
        {/if}
      </section>
    {/if}

    <section>
      <h4>Tracks</h4>
      {#if !detail.tracks.length}
        <p class="empty">No tracks yet.</p>
      {:else}
        <ol class="tracks">
          {#each detail.tracks as track (track.id)}
            <li>
              <span class="position">{track.position}</span>
              <span class="info">
                {#if track.uri}<a href={track.uri} target="_blank" rel="noreferrer">{track.title}</a>{:else}{track.title}{/if}
                <span class="meta">{track.author ?? 'unknown'} • {formatLength(track.lengthMs)} • added by {track.addedBy}</span>
              </span>
              {#if access.update}
                <button title="Move up" disabled={busy || track.position === 1} on:click={() => move(track, -1)}>↑</button>
                <button title="Move down" disabled={busy || track.position === detail.tracks.length} on:click={() => move(track, 1)}>↓</button>
              {/if}
              {#if access.delete}
                <button title="Remove" disabled={busy} on:click={() => remove(track)}>✕</button>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    {#if access.update}
      <section>
        <h4>Details</h4>
        <form class="edit" on:submit|preventDefault={saveDetails}>
          <input bind:value={editName} maxlength="100" required />
          <input bind:value={editDescription} placeholder="Description" maxlength="300" />
          <button type="submit" disabled={busy || !editName.trim()}>Save</button>
        </form>
        <div class="cover-controls">
          <label class="file">
            Upload cover
            <input bind:this={coverInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" on:change={uploadCover} disabled={busy} />
          </label>
          {#if detail.coverUrl}<button on:click={removeCover} disabled={busy}>Remove cover</button>{/if}
          <span class="hint">PNG, JPEG, GIF or WEBP, up to 1 MiB.</span>
        </div>
      </section>
    {/if}

    {#if access.manage}
      <section>
        <h4>Sharing</h4>
        <label>
          <input type="checkbox" checked={detail.isPublic} disabled={busy} on:change={(e) => setPublic(e.currentTarget.checked)} />
          Public - anyone in a server you share with the bot can view and play it
        </label>

        <table class="grants">
          <thead>
            <tr>
              <th>User</th>
              {#each FLAGS as flag}<th title={flag.hint}>{flag.label}</th>{/each}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each detail.grants as existing (existing.userId)}
              <tr>
                <td>{existing.username}</td>
                {#each FLAGS as flag}
                  <td>
                    <input
                      type="checkbox"
                      title={flag.hint}
                      checked={existing[flag.key]}
                      disabled={busy}
                      on:change={() => toggleGrant(existing, flag.key)}
                    />
                  </td>
                {/each}
                <td><button disabled={busy} on:click={() => revoke(existing)}>Revoke</button></td>
              </tr>
            {/each}
            <tr>
              <td><input bind:value={granteeInput} placeholder="User ID or exact name" /></td>
              {#each FLAGS as flag}
                <td><input type="checkbox" title={flag.hint} bind:checked={newFlags[flag.key]} /></td>
              {/each}
              <td><button class="primary" disabled={busy || !granteeInput.trim()} on:click={grant}>Grant</button></td>
            </tr>
          </tbody>
        </table>
        <p class="hint">R view and play • C add tracks • U reorder, rename, change the cover • D remove tracks</p>

        <button class="danger" disabled={busy} on:click={deletePlaylist}>Delete playlist</button>
      </section>
    {/if}
  {/if}
</div>

<style>
  .detail { background: #16213e; border-radius: 10px; padding: 1rem; display: grid; gap: 1rem; }
  .back { justify-self: start; background: none; border: none; color: #a0a0c0; cursor: pointer; padding: 0; }
  header { display: flex; gap: 1rem; align-items: center; }
  .cover { width: 96px; height: 96px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
  .placeholder { display: grid; place-items: center; background: #2a2a4a; font-size: 2rem; }
  h3 { margin: 0; font-size: 1.1rem; }
  h4 { margin: 0 0 0.5rem; font-size: 0.85rem; color: #a0a0c0; text-transform: uppercase; letter-spacing: 0.04em; }
  .description { margin: 0.25rem 0 0; color: #c0c0d8; font-size: 0.9rem; }
  .meta { margin: 0.25rem 0 0; font-size: 0.75rem; color: #6a6a8a; }
  .badge { margin-left: 0.4rem; font-size: 0.65rem; background: #2a2a4a; color: #a0a0c0; padding: 0.05rem 0.35rem; border-radius: 4px; vertical-align: middle; }
  section { display: grid; gap: 0.5rem; }
  .play, .add, .cover-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .add form, .edit { display: flex; flex-wrap: wrap; gap: 0.5rem; flex: 1; }
  .add form input, .edit input { flex: 1; min-width: 10rem; }
  label { font-size: 0.85rem; color: #a0a0c0; }
  input:not([type='checkbox']) { background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.85rem; }
  input[type='number'] { width: 3.5rem; }
  button { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
  button:hover:not(:disabled) { background: #5865f2; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: #5865f2; }
  button.danger { justify-self: start; background: #8b2c2c; }
  .tracks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; max-height: 420px; overflow-y: auto; }
  .tracks li { display: flex; align-items: center; gap: 0.5rem; background: #0f0f1e; border-radius: 6px; padding: 0.35rem 0.5rem; }
  .position { width: 1.75rem; text-align: right; color: #6a6a8a; font-size: 0.8rem; flex-shrink: 0; }
  .info { flex: 1; display: flex; flex-direction: column; overflow: hidden; font-size: 0.9rem; }
  .info a { color: #e0e0f0; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .info a:hover { text-decoration: underline; }
  .file { position: relative; background: #2a2a4a; color: #e0e0f0; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
  .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .grants { border-collapse: collapse; font-size: 0.85rem; }
  .grants th, .grants td { padding: 0.3rem 0.5rem; text-align: center; border-bottom: 1px solid #2a2a4a; }
  .grants th:first-child, .grants td:first-child { text-align: left; }
  .hint { font-size: 0.75rem; color: #6a6a8a; margin: 0; }
  .empty { color: #6a6a8a; font-size: 0.9rem; margin: 0; }
</style>
