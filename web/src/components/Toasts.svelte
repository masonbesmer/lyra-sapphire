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
    color: #e0e0f0;
    border: 1px solid;
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  }
  .toast.error { background: #3a1a28; border-color: #ed4245; }
  .toast.info { background: #16213e; border-color: #5865f2; }
</style>
