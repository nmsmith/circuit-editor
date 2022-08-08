<script lang="ts">
   import type { LineSegment } from "~/shared/geometry"
   export let renderStyle: "default" | "hover" | "select" | "debug" = "default"
   export let segment: LineSegment
   export let isRigid: boolean = false
   $: start = segment.start
   $: end = segment.end
</script>

<line
   class="fluid {isRigid ? 'frozen' : 'relaxed'} line {renderStyle} stroke"
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
   .select,
   .debug {
      stroke-width: 8px;
   }
</style>
