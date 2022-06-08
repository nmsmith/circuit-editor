<script lang="ts">
   import type { Point, LineSegment } from "~/shared/geometry"
   export let renderType: "default" | "highlight" | "selectLight" = "default"
   export let segment: LineSegment
   $: start = segment.start
   $: end = segment.end
</script>

<line
   class="fluidLine {renderType}"
   x1={start.x}
   y1={start.y}
   x2={end.x}
   y2={end.y}
/>

<style>
   .default {
      stroke-width: 3px;
   }
   .highlight,
   .selectLight {
      stroke-width: 9px;
   }
</style>
