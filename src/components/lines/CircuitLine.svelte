<script lang="ts">
   import type { LineType } from "~/shared/definitions"
   import type { LineSegment } from "~/shared/geometry"
   export let renderStyle: "default" | "hover" | "grab" | "debug" = "default"
   export let type: LineType
   export let segment: LineSegment
   export let isRigid: boolean = false
   $: start = segment.start
   $: end = segment.end
</script>

<line
   class="fluid {isRigid ? 'frozen' : 'relaxed'} line {renderStyle} stroke"
   stroke={type.color}
   stroke-width={type.thickness}
   stroke-dasharray={type.dasharray}
   x1={start.x}
   y1={start.y}
   x2={end.x}
   y2={end.y}
/>

<style>
   .hover,
   .grab,
   .debug {
      stroke-width: 8px;
   }
</style>
