<script lang="ts">
  import { THEME_CHOICES, themeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme';

  const labels: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
</script>

<div class="theme-toggle" role="group" aria-label="Theme">
  {#each THEME_CHOICES as choice}
    <button
      class:active={$themeChoice === choice}
      aria-pressed={$themeChoice === choice}
      on:click={() => setThemeChoice(choice)}
    >
      {labels[choice]}
    </button>
  {/each}
</div>

<style>
  .theme-toggle { display: flex; border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden; }
  button { background: var(--color-surface); color: var(--color-text-muted); border: none; padding: 0.3rem 0.6rem; font-size: 0.78rem; cursor: pointer; }
  button + button { border-left: 1px solid var(--color-border); }
  button:hover { color: var(--color-text); }
  button.active { background: var(--color-accent); color: var(--color-on-accent); }
</style>
