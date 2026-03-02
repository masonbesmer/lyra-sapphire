<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>

<div class="login-page">
  <div class="card">
    <h2>Welcome to Lyra Dashboard</h2>
    <p>Sign in with Discord to manage your server's music.</p>
    <button class="discord-btn" on:click={() => dispatch('login')}>
      <svg width="20" height="20" viewBox="0 0 71 55" fill="none">
        <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.5a40.4 40.4 0 0 0-1.8 3.7 54.1 54.1 0 0 0-16.3 0A40.4 40.4 0 0 0 25.6.5 58.4 58.4 0 0 0 11 4.9C1.6 19.1-1 33 .3 46.7a59 59 0 0 0 18 9.1 44.8 44.8 0 0 0 3.9-6.3 38.4 38.4 0 0 1-6.1-2.9l1.5-1.2a42.2 42.2 0 0 0 36.1 0l1.5 1.2a38.4 38.4 0 0 1-6.1 2.9 44.5 44.5 0 0 0 3.9 6.3 58.9 58.9 0 0 0 18-9.1C72.4 30.5 68.5 16.7 60.1 4.9ZM23.7 38.2c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2 6.5 3.2 6.4 7.2c0 4-2.8 7.2-6.4 7.2Zm23.7 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2 6.5 3.2 6.4 7.2c0 4-2.8 7.2-6.4 7.2Z" fill="white"/>
      </svg>
      Login with Discord
    </button>
  </div>
</div>

<style>
  .login-page { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
  .card { background: #16213e; border-radius: 12px; padding: 2.5rem; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
  h2 { margin: 0 0 0.5rem; }
  p { color: #a0a0c0; margin-bottom: 1.5rem; }
  .discord-btn { display: flex; align-items: center; gap: 0.5rem; background: #5865f2; color: white; border: none; padding: 0.7rem 1.5rem; border-radius: 6px; font-size: 1rem; cursor: pointer; margin: 0 auto; }
  .discord-btn:hover { background: #4752c4; }
</style>
