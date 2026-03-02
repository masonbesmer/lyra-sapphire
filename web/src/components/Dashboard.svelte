<script>
  import { onMount, onDestroy } from 'svelte';
  import NowPlaying from './NowPlaying.svelte';
  import Queue from './Queue.svelte';
  import Controls from './Controls.svelte';
  import History from './History.svelte';

  export let guild;

  let queue = null;
  let ws = null;
  let activeTab = 'player';

  async function fetchQueue() {
    const res = await fetch(`/api/guilds/${guild.id}/queue`);
    if (res.ok) queue = await res.json();
  }

  function connectWs() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', guildId: guild.id }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'queueUpdate') queue = msg.queue;
    };
    ws.onclose = () => setTimeout(connectWs, 3000);
  }

  onMount(() => { fetchQueue(); connectWs(); });
  onDestroy(() => ws?.close());

  async function apiPost(endpoint, body = {}) {
    const res = await fetch(`/api/guilds/${guild.id}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) await fetchQueue();
    return res;
  }
</script>

<div class="dashboard">
  <h2>{guild.name}</h2>

  <div class="tabs">
    <button class:active={activeTab === 'player'} on:click={() => (activeTab = 'player')}>🎵 Player</button>
    <button class:active={activeTab === 'history'} on:click={() => (activeTab = 'history')}>📜 History</button>
  </div>

  {#if activeTab === 'player'}
    <div class="player-section">
      <NowPlaying {queue} />
      <Controls {queue} {apiPost} {guild} />
      <Queue {queue} {apiPost} />
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
