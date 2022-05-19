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

<path
   class="fluidLine"
   d="M{start.x},{start.y} A 7.5,7.5 0 0 0 {end.x},{end.y}"
/>

<style>
   .fluidLine {
      fill: none;
      stroke-width: 3px;
      stroke-linecap: round;
   }
</style>
