<script lang="ts">
  import { toasts, dismissToast } from '../lib/toast';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each $toasts as toast (toast.id)}
    <button class="toast {toast.kind}" on:click={() => dismissToast(toast.id)} title="Dismiss">
      {toast.message}
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(360px, calc(100vw - 2rem));
  }
  .toast {
    text-align: left;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--color-text);
    border: 1px solid;
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    cursor: pointer;
    box-shadow: 0 6px 20px var(--color-shadow);
  }
  .toast.error { background: var(--color-danger-surface); border-color: var(--color-danger); }
  .toast.info { background: var(--color-surface); border-color: var(--color-accent); }
</style>
