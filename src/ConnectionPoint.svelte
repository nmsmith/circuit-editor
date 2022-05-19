<script lang="ts">
   import type { Point } from "./math"
   export let position: Point
   export let highlighted: boolean = false
   export let selected: boolean = false
   let flair: string
   $: {
      flair = ""
      if (highlighted) flair += "highlighted"
      if (selected) flair += " selected"
   }
</script>

{#if flair}
   <circle class={flair} cx={position.x} cy={position.y} r={10} />
{/if}
<circle class="fluidLine" cx={position.x} cy={position.y} r={6} />
