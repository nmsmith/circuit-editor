<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let renderStyle: "default" | "highlight" | "selectLight" = "default"
   export let position: Point
</script>

<circle
   class={renderStyle}
   cx={position.x}
   cy={position.y}
   r={renderStyle === "default" ? 6 : 10}
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
