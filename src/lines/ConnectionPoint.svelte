<script lang="ts">
   import type { Point } from "../math"
   export let renderType: "default" | "highlight" | "selectLight" = "default"
   export let position: Point
</script>

<circle
   class={renderType}
   cx={position.x}
   cy={position.y}
   r={renderType === "default" ? 6 : 10}
/>

<style>
   .default {
      stroke: none;
      fill: blue;
   }
   .highlight {
      stroke: none;
      fill: rgb(0, 234, 255);
   }
   .selectLight {
      stroke: none;
      fill: yellow;
   }
</style>
