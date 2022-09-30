<script lang="ts">
   import { highlightThickness, LineType } from "~/shared/circuit"
   import type { LineSegment } from "~/shared/geometry"
   export let type: LineType
   export let segment: LineSegment
   export let highlight: boolean = false
   export let className: string = ""
</script>

<line
   class={highlight ? "" : className}
   stroke={highlight ? "currentColor" : type.color}
   stroke-width={highlight
      ? type.thickness + highlightThickness
      : type.thickness}
   stroke-dasharray={type.dasharray}
   stroke-linejoin="round"
   stroke-linecap="round"
   x1={segment.start.x}
   y1={segment.start.y}
   x2={segment.end.x}
   y2={segment.end.y}
/>

<style>
   .rigid {
      stroke: rgb(113, 68, 29);
   }
</style>
