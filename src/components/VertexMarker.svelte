<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let renderType: "default" | "highlight" | "selectLight" = "default"
   export let position: Point
   const w = 6
   $: [x, y] = [position.x, position.y]
</script>

<polygon
   class={renderType}
   points="{x - w},{y} {x},{y - w} {x + w},{y} {x},{y + w}"
/>

<style>
   .default {
      fill: rgb(193, 195, 199);
      stroke: black;
      stroke-width: 3px;
   }
   .highlight {
      fill: rgb(0, 234, 255);
      stroke: rgb(0, 234, 255);
      stroke-width: 10px;
   }
   .selectLight {
      fill: yellow;
      stroke: yellow;
      stroke-width: 10px;
   }
</style>
