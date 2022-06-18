<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let renderStyle: "default" | "hover" | "select" = "default"
   export let position: Point
   const diagonalLength = 12
   $: width = Math.sqrt(0.5 * diagonalLength * diagonalLength) // x/y width
   $: w = width.toFixed(1)
   $: topLeft = {
      x: (position.x - 0.5 * width).toFixed(1),
      y: (position.y - 0.5 * width).toFixed(1),
   }
   $: bottomLeft = {
      x: topLeft.x,
      y: (position.y + 0.5 * width).toFixed(1),
   }
</script>

<path
   class="plug {renderStyle} stroke"
   d="M{topLeft.x},{topLeft.y} l {w},{w} M{bottomLeft.x},{bottomLeft.y} l{w},{-w}"
/>

<style>
   .plug {
      stroke-linecap: round;
   }
   .default {
      stroke: black;
      stroke-width: 3px;
   }
   .hover,
   .select {
      stroke-width: 9.5px;
   }
</style>
