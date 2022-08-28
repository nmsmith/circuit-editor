<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let start: Point
   export let end: Point
   export let scale: number
   $: sWidth = 2 / scale
   $: sDash = `${8 / scale} ${8 / scale}`
</script>

<line
   stroke-width={sWidth}
   stroke-dasharray={sDash}
   x1={start.x}
   y1={start.y}
   x2={end.x}
   y2={start.y}
/>
<line
   stroke-width={sWidth}
   stroke-dasharray={sDash}
   x1={start.x}
   y1={start.y}
   x2={start.x}
   y2={end.y}
/>
<line
   stroke-width={sWidth}
   stroke-dasharray={sDash}
   x1={start.x}
   y1={end.y}
   x2={end.x}
   y2={end.y}
/>
<line
   stroke-width={sWidth}
   stroke-dasharray={sDash}
   x1={end.x}
   y1={start.y}
   x2={end.x}
   y2={end.y}
/>

<style>
   line {
      stroke: black;
      transform: translate(0.5px, 0.5px); /* to render without aliasing */
   }
</style>
