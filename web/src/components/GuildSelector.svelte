<script>
  import { createEventDispatcher } from 'svelte';
  export let guilds = [];
  const dispatch = createEventDispatcher();
</script>

<div>
  <h2>Select a Server</h2>
  {#if guilds.length === 0}
    <p>No shared servers found. Make sure Lyra is in your server.</p>
  {:else}
    <div class="grid">
      {#each guilds as guild}
        <button class="guild-card" on:click={() => dispatch('select', guild)}>
          {#if guild.icon}
            <img src="https://cdn.discordapp.com/icons/{guild.id}/{guild.icon}.png?size=64" alt="{guild.name}" />
          {:else}
            <div class="guild-icon-placeholder">{guild.name.slice(0, 2)}</div>
          {/if}
          <span>{guild.name}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  h2 { margin-bottom: 1rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1rem; }
  .guild-card { background: #16213e; border: 1px solid #2a2a4a; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; cursor: pointer; color: #e0e0f0; font-size: 0.9rem; text-align: center; transition: background 0.15s; }
  .guild-card:hover { background: #1e2a50; border-color: #5865f2; }
  .guild-card img { border-radius: 50%; width: 56px; height: 56px; }
  .guild-icon-placeholder { width: 56px; height: 56px; border-radius: 50%; background: #5865f2; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; font-weight: bold; }
</style>
