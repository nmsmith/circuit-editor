<script lang="ts">
   import type { Point } from "./math"
   export let start: Point
   export let end: Point
   export let flip: boolean = false
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
   <path
      class={flair}
      d="M{start.x},{start.y} A 7.5,7.5 0 0 {+flip} {end.x},{end.y}"
   />
   />
{/if}
<path
   class="fluidLine"
   d="M{start.x},{start.y} A 7.5,7.5 0 0 {+flip} {end.x},{end.y}"
/>

<style>
   .fluidLine {
      fill: none;
      stroke-width: 3px;
      stroke-linecap: round;
   }
   .highlighted,
   .selected {
      fill: none;
      stroke-width: 9px;
      stroke-linecap: round;
   }
</style>
