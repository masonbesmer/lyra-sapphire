<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import NowPlaying from './NowPlaying.svelte';
  import Queue from './Queue.svelte';
  import Controls from './Controls.svelte';
  import History from './History.svelte';
  import { queue, connectQueue, disconnectQueue } from '../lib/stores';
  import { guildApi } from '../lib/api';
  import type { Guild } from '../lib/types';

  export let guild: Guild;

  let activeTab: 'player' | 'history' = 'player';

  $: api = guildApi(guild.id);

  onMount(() => connectQueue(guild.id));
  onDestroy(disconnectQueue);
</script>

<div class="dashboard">
  <h2>{guild.name}</h2>

  <div class="tabs">
    <button class:active={activeTab === 'player'} on:click={() => (activeTab = 'player')}>🎵 Player</button>
    <button class:active={activeTab === 'history'} on:click={() => (activeTab = 'history')}>📜 History</button>
  </div>

  {#if activeTab === 'player'}
    <div class="player-section">
      <NowPlaying queue={$queue} />
      <Controls queue={$queue} {api} />
      <Queue queue={$queue} {api} />
    </div>
  {:else if activeTab === 'history'}
    <History guildId={guild.id} />
  {/if}
</div>

<style>
  .dashboard h2 { margin: 0 0 1rem; }
  .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
  .tabs button { background: #16213e; border: 1px solid #2a2a4a; color: #a0a0c0; padding: 0.4rem 1rem; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
  .tabs button.active { background: #5865f2; color: white; border-color: #5865f2; }
  .player-section { display: grid; gap: 1rem; }
</style>
