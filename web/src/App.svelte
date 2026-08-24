<script lang="ts">
  import { onMount } from 'svelte';
  import Login from './components/Login.svelte';
  import GuildSelector from './components/GuildSelector.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import Toasts from './components/Toasts.svelte';
  import { apiGet, apiPost } from './lib/api';
  import type { DiscordUser, Guild } from './lib/types';

  let user: DiscordUser | null = null;
  let guilds: Guild[] = [];
  let selectedGuild: Guild | null = null;
  let loading = true;

  onMount(async () => {
    // A logged-out visitor 401s here by design, so don't toast it at them.
    user = await apiGet<DiscordUser>('/oauth/@me', { quiet: true });
    if (user) guilds = (await apiGet<Guild[]>('/api/guilds')) ?? [];
    loading = false;
  });

  function handleLogin() {
    window.location.href = '/oauth/login';
  }

  async function handleLogout() {
    await apiPost('/oauth/logout');
    user = null;
    guilds = [];
    selectedGuild = null;
  }
</script>

<main>
  <header>
    <h1>🎵 Lyra Dashboard</h1>
    {#if user}
      <div class="user-info">
        <img src="https://cdn.discordapp.com/avatars/{user.id}/{user.avatar}.png?size=32" alt="avatar" />
        <span>{user.username}</span>
        <button on:click={handleLogout}>Logout</button>
      </div>
    {/if}
  </header>

  {#if loading}
    <p class="loading">Loading...</p>
  {:else if !user}
    <Login on:login={handleLogin} />
  {:else if !selectedGuild}
    <GuildSelector {guilds} on:select={(e) => (selectedGuild = e.detail)} />
  {:else}
    <button class="back" on:click={() => (selectedGuild = null)}>← Back</button>
    <Dashboard guild={selectedGuild} />
  {/if}
</main>

<Toasts />

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0f0;
  }
  main { max-width: 900px; margin: 0 auto; padding: 1rem; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { margin: 0; font-size: 1.8rem; }
  .user-info { display: flex; align-items: center; gap: 0.5rem; }
  .user-info img { border-radius: 50%; width: 32px; height: 32px; }
  .loading { text-align: center; padding: 2rem; }
  .back { background: #5865f2; color: white; border: none; padding: 0.4rem 1rem; border-radius: 4px; cursor: pointer; margin-bottom: 1rem; }
  button { cursor: pointer; }
</style>
