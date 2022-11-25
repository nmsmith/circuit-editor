<script lang="ts">
   import { strokeHighlightThickness, LineType } from "~/shared/circuit"
   import type { LineSegment } from "~/shared/geometry"
   export let type: LineType
   export let segment: LineSegment
   export let render: "segment" | "highlight" | "rigid" = "segment"
   const rigidThickness = 12
</script>

<line
   stroke={render === "segment" ? type.color : "currentColor"}
   stroke-width={render === "segment"
      ? type.thickness
      : render === "highlight"
      ? type.thickness + strokeHighlightThickness
      : type.thickness + rigidThickness}
   stroke-dasharray={type.dasharray}
   stroke-linejoin="round"
   stroke-linecap="round"
   x1={segment.start.x}
   y1={segment.start.y}
   x2={segment.end.x}
   y2={segment.end.y}
/>
