<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let start: Point
   export let end: Point
</script>

<line x1={start.x} y1={start.y} x2={end.x} y2={start.y} />
<line x1={start.x} y1={start.y} x2={start.x} y2={end.y} />
<line x1={start.x} y1={end.y} x2={end.x} y2={end.y} />
<line x1={end.x} y1={start.y} x2={end.x} y2={end.y} />

<style>
   line {
      stroke: black;
      stroke-width: 2px;
      stroke-dasharray: 8 8;
      transform: translate(0.5px, 0.5px); /* to render without aliasing */
   }
</style>
