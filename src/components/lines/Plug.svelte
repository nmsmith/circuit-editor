<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let renderType: "default" | "highlight" | "selectLight" = "default"
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
   class="plug {renderType}"
   d="M{topLeft.x},{topLeft.y} l {w},{w} M{bottomLeft.x},{bottomLeft.y} l{w},{-w}"
/>

<style>
   .plug {
      fill: none;
      stroke-linecap: round;
   }
   .default {
      stroke: black;
      stroke-width: 3px;
   }
   .highlight {
      stroke: rgb(0, 234, 255);
      stroke-width: 10px;
   }
   .selectLight {
      stroke: yellow;
      stroke-width: 10px;
   }
</style>
