<script lang="ts">
   import type { Point } from "./math"
   export let start: Point
   export let end: Point
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
   <line class={flair} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
{/if}
<line class="fluidLine" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />

<style>
   .fluidLine {
      stroke-width: 3px;
   }
   .highlighted,
   .selected {
      stroke-width: 9px;
   }
</style>
