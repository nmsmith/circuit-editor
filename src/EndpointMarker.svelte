<script lang="ts">
   import type { Point } from "./math"
   export let position: Point
   export let highlighted: boolean = false
   export let selected: boolean = false
   const w = 6
   const hw = w + 7
   $: [x, y] = [position.x, position.y]
   let flair: string
   $: {
      flair = ""
      if (highlighted) flair += "highlighted"
      if (selected) flair += " selected"
   }
</script>

{#if flair}
   <path
      class={flair}
      d="M{x - hw},{y} L{x},{y - hw} L{x + hw},{y} L{x},{y + hw} Z"
   />
{/if}
<path class="hint" d="M{x - w},{y} L{x},{y - w} L{x + w},{y} L{x},{y + w} Z" />

<style>
   .hint {
      fill: rgb(193, 195, 199);
      stroke: black;
      stroke-width: 3px;
   }
   .highlighted,
   .selected {
      stroke-width: 0;
   }
</style>
