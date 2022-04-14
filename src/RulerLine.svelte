<script lang="ts">
   import type { Point } from "./math"
   export let start: Point
   export let end: Point
   export let opacity: number
</script>

<line x1={start.x} y1={start.y} x2={end.x} y2={end.y} {opacity} />

<style>
   line {
      stroke: rgb(225, 225, 225);
      stroke-width: 6px;
   }
</style>
