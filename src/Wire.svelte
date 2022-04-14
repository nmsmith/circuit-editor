<script lang="ts">
   import type { Point } from "./math"
   export let start: Point
   export let end: Point
   export let highlighted: boolean = false
</script>

{#if highlighted}
   <line class="highlight" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
{/if}
<line class="fluidLine" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />

<style>
   .fluidLine {
      stroke-width: 3px;
   }
   .highlight {
      stroke-width: 7px;
   }
</style>
