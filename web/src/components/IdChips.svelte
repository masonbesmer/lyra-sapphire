<script lang="ts">
  /** A set of roles or channels as removable chips, plus a picker to add one. Edits `selected` in place. */
  export let items: { id: string; name: string }[];
  export let selected: string[];
  export let prefix = '';
  export let placeholder = 'Add...';
  export let disabled = false;

  let pick = '';

  function name(id: string): string {
    return `${prefix}${items.find((item) => item.id === id)?.name ?? id}`;
  }

  function add() {
    if (pick && !selected.includes(pick)) selected = [...selected, pick];
    pick = '';
  }
</script>

<div class="chips">
  {#each selected as id (id)}
    <span class="chip">{name(id)}<button type="button" title="Remove" {disabled} on:click={() => (selected = selected.filter((entry) => entry !== id))}>✕</button></span>
  {/each}
  <select bind:value={pick} on:change={add} {disabled} aria-label={placeholder}>
    <option value="">{placeholder}</option>
    {#each items.filter((item) => !selected.includes(item.id)) as item}<option value={item.id}>{prefix}{item.name}</option>{/each}
  </select>
</div>
