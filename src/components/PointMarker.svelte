<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let renderStyle: "default" | "hover" | "select" | "debug" = "default"
   export let position: Point
   const w = 6
   $: [x, y] = [position.x, position.y]
</script>

<polygon
   class="{renderStyle} fill stroke"
   points="{x - w},{y} {x},{y - w} {x + w},{y} {x},{y + w}"
/>

<style>
   .default {
      fill: rgb(193, 195, 199);
      stroke: black;
      stroke-width: 3px;
   }
   .hover,
   .select,
   .debug {
      stroke-width: 9px;
   }
</style>
