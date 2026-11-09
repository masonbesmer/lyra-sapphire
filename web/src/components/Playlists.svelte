<script lang="ts">
  import { onMount } from 'svelte';
  import { guildApi } from '../lib/api';
  import { queue } from '../lib/stores';
  import { pushInfo } from '../lib/toast';
  import { addNowPlaying, formatLength } from '../lib/playlists';
  import type { PlaylistLists, PlaylistSummary } from '../lib/types';
  import PlaylistDetail from './PlaylistDetail.svelte';

  export let guildId: string;

  $: api = guildApi(guildId);

  let lists: PlaylistLists | null = null;
  let selectedId: number | null = null;

  let name = '';
  let description = '';
  let isPublic = false;
  let creating = false;

  async function load() {
    lists = await api.get<PlaylistLists>('playlists');
  }

  async function create() {
    if (!name.trim()) return;
    creating = true;
    const res = await api.post<{ ok: true; playlist: PlaylistSummary }>('playlists', { name, description: description || null, isPublic });
    creating = false;
    if (!res) return;
    pushInfo(`Created ${res.playlist.name}`);
    name = '';
    description = '';
    isPublic = false;
    await load();
  }

  async function saveNowPlaying(playlist: PlaylistSummary) {
    if (await addNowPlaying(api, playlist)) await load();
  }

  $: sections = lists
    ? [
        { title: 'Yours', playlists: lists.owned, empty: 'You have no playlists yet - make one below.' },
        { title: 'Shared with you', playlists: lists.shared, empty: 'Nobody has shared a playlist with you.' },
        { title: 'Public in this server', playlists: lists.public, empty: 'No one here has a public playlist.' }
      ]
    : [];

  onMount(load);
</script>

{#if selectedId !== null}
  <PlaylistDetail
    {api}
    playlistId={selectedId}
    onBack={() => {
      selectedId = null;
      load();
    }}
  />
{:else}
  <div class="playlists">
    <h3>📚 Playlists</h3>

    {#if !lists}
      <p class="empty">Loading...</p>
    {:else}
      {#each sections as section (section.title)}
        <section>
          <h4>{section.title}</h4>
          {#if !section.playlists.length}
            <p class="empty">{section.empty}</p>
          {:else}
            <ul>
              {#each section.playlists as playlist (playlist.id)}
                <li>
                  <button class="open" on:click={() => (selectedId = playlist.id)}>
                    {#if playlist.coverUrl}
                      <img src={playlist.coverUrl} alt="" />
                    {:else}
                      <span class="placeholder">🎵</span>
                    {/if}
                    <span class="info">
                      <span class="name">{playlist.name}{#if playlist.isPublic}<span class="badge">public</span>{/if}</span>
                      <span class="meta">
                        by {playlist.owner.username} • {playlist.trackCount} tracks{#if playlist.totalLengthMs} • {formatLength(playlist.totalLengthMs)}{/if}
                      </span>
                    </span>
                  </button>
                  {#if playlist.access.create && $queue?.current}
                    <button class="now-playing" title="Add the current track" on:click={() => saveNowPlaying(playlist)}>+ Now playing</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    {/if}

    <form class="create" on:submit|preventDefault={create}>
      <h4>New playlist</h4>
      <input bind:value={name} placeholder="Name" maxlength="100" required />
      <input bind:value={description} placeholder="Description (optional)" maxlength="300" />
      <label><input type="checkbox" bind:checked={isPublic} /> Public - anyone in a server you share can play it</label>
      <button type="submit" disabled={creating || !name.trim()}>{creating ? '...' : 'Create'}</button>
    </form>
  </div>
{/if}

<style>
  .playlists { background: #16213e; border-radius: 10px; padding: 1rem; display: grid; gap: 1rem; }
  h3 { margin: 0; font-size: 1rem; }
  h4 { margin: 0 0 0.5rem; font-size: 0.85rem; color: #a0a0c0; text-transform: uppercase; letter-spacing: 0.04em; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li { display: flex; align-items: center; gap: 0.5rem; background: #0f0f1e; border-radius: 6px; padding: 0.4rem; }
  .open { flex: 1; display: flex; align-items: center; gap: 0.6rem; background: none; border: none; color: #e0e0f0; text-align: left; cursor: pointer; padding: 0; overflow: hidden; }
  img, .placeholder { width: 44px; height: 44px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
  .placeholder { display: grid; place-items: center; background: #2a2a4a; }
  .info { display: flex; flex-direction: column; overflow: hidden; }
  .name { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 0.75rem; color: #6a6a8a; }
  .badge { margin-left: 0.4rem; font-size: 0.65rem; background: #2a2a4a; color: #a0a0c0; padding: 0.05rem 0.35rem; border-radius: 4px; }
  .now-playing { background: #2a2a4a; color: #e0e0f0; border: none; padding: 0.3rem 0.7rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
  .now-playing:hover { background: #5865f2; }
  .create { display: grid; gap: 0.5rem; border-top: 1px solid #2a2a4a; padding-top: 1rem; }
  .create input:not([type='checkbox']) { background: #0f0f1e; border: 1px solid #2a2a4a; color: #e0e0f0; padding: 0.4rem 0.7rem; border-radius: 6px; font-size: 0.9rem; }
  .create label { font-size: 0.85rem; color: #a0a0c0; }
  .create button { justify-self: start; background: #5865f2; color: white; border: none; padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer; }
  .create button:disabled { opacity: 0.6; cursor: not-allowed; }
  .empty { color: #6a6a8a; font-size: 0.9rem; margin: 0; }
</style>
