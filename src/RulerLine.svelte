<script lang="ts">
   import type { Point } from "./math"
   export let start: Point
   export let end: Point
   export let opacity: number
</script>

<line
   x1={start.x}
   y1={start.y}
   x2={end.x}
   y2={end.y}
   opacity={0.16 * opacity}
/>

<style>
   line {
      stroke: black;
      stroke-width: 7px;
   }
</style>
