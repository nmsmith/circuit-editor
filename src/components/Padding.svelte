<script lang="ts">
   import { Point, Axis, Segment, Box } from "~/shared/math"
   export let segment: Segment
   $: padding = { left: 15, right: 15, top: 15, bottom: 15 }
   // segment.axis.x === 0 || segment.axis.y === 0
   //    ? { left: 15, right: 15, top: 15, bottom: 15 }
   //    : { left: 10.6, right: 10.6, top: 10.6, bottom: 10.6 }
   $: style =
      segment.axis.x === 0 || segment.axis.y === 0
         ? "selectDrag"
         : "selectOther"
   $: box = Box.fromPaddedSegment(segment, padding)
   $: [topLeft, topRight, bottomRight, bottomLeft] = box.corners()
   function f(p: Point): string {
      return p.x + "," + p.y
   }
</script>

<path
   class={style}
   d="M {f(topLeft)} L {f(topRight)} L {f(bottomRight)} L {f(bottomLeft)} Z"
/>

<style>
   path {
      fill: /*rgba(0, 0, 0, 0.3);*/ rgb(144, 144, 144);
      stroke: rgb(143, 143, 143);
      stroke-width: 1px;
   }
   .selectDrag {
      fill: rgb(224, 224, 224);
   }
   .selectOther {
      fill: rgb(199, 167, 167);
   }
</style>
