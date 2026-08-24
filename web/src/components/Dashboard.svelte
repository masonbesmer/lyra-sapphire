<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import NowPlaying from './NowPlaying.svelte';
  import Queue from './Queue.svelte';
  import Controls from './Controls.svelte';
  import History from './History.svelte';
  import SearchBar from './SearchBar.svelte';
  import FilterPanel from './FilterPanel.svelte';
  import Equalizer from './Equalizer.svelte';
  import LyricsPanel from './LyricsPanel.svelte';
  import Leaderboard from './Leaderboard.svelte';
  import { queue, voiceState, connectQueue, disconnectQueue } from '../lib/stores';
  import { guildApi } from '../lib/api';
  import type { Guild } from '../lib/types';

  export let guild: Guild;

  let activeTab: 'player' | 'history' | 'leaderboard' = 'player';

  $: api = guildApi(guild.id);
  // null = not resolved yet, so the "join a channel" notice doesn't flash during load.
  $: voiceChannelId = $voiceState?.channelId ?? null;

  onMount(() => connectQueue(guild.id));
  onDestroy(disconnectQueue);
</script>

<div class="dashboard">
  <h2>{guild.name}</h2>

  <div class="tabs">
    <button class:active={activeTab === 'player'} on:click={() => (activeTab = 'player')}>🎵 Player</button>
    <button class:active={activeTab === 'history'} on:click={() => (activeTab = 'history')}>📜 History</button>
    <button class:active={activeTab === 'leaderboard'} on:click={() => (activeTab = 'leaderboard')}>🏆 Leaderboard</button>
  </div>

  {#if activeTab === 'player'}
    {#if !$voiceState}
      <p class="notice">Checking your voice channel...</p>
    {:else if !voiceChannelId}
      <p class="notice">
        Join a voice channel in <strong>{guild.name}</strong> to use the player. Everything queues into
        whichever channel you're sitting in.
      </p>
    {:else}
      <div class="player-section">
        <p class="channel">🔊 Connected to <strong>{$voiceState.channelName}</strong></p>
        <NowPlaying queue={$queue} {api} />
        <Controls queue={$queue} {api} />
        <SearchBar {api} {voiceChannelId} />
        <FilterPanel {api} />
        <Equalizer queue={$queue} {api} />
        <LyricsPanel queue={$queue} {api} />
        <Queue queue={$queue} {api} />
      </div>
    {/if}
  {:else if activeTab === 'history'}
    <History guildId={guild.id} />
  {:else if activeTab === 'leaderboard'}
    <Leaderboard guildId={guild.id} />
  {/if}
</div>

<style>
  .dashboard h2 { margin: 0 0 1rem; }
  .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
  .tabs button { background: #16213e; border: 1px solid #2a2a4a; color: #a0a0c0; padding: 0.4rem 1rem; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
  .tabs button.active { background: #5865f2; color: white; border-color: #5865f2; }
  .player-section { display: grid; gap: 1rem; }
  .notice { background: #16213e; border: 1px solid #2a2a4a; border-radius: 10px; padding: 1.25rem; margin: 0; color: #a0a0c0; line-height: 1.5; }
  .channel { margin: 0; font-size: 0.85rem; color: #6a6a8a; }
</style>
