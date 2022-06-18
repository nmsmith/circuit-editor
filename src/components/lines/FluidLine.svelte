<script lang="ts">
   import type { Point, LineSegment } from "~/shared/geometry"
   export let renderStyle: "default" | "hover" | "select" = "default"
   export let segment: LineSegment
   $: start = segment.start
   $: end = segment.end
</script>

<line
   class="fluid line {renderStyle} stroke"
   x1={start.x}
   y1={start.y}
   x2={end.x}
   y2={end.y}
/>

<style>
   .default {
      stroke-width: 3px;
   }
   .hover,
   .select {
      stroke-width: 8px;
   }
</style>
