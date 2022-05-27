<script lang="ts">
   import type { Point } from "~/shared/math"
   export let renderType: "default" | "highlight" | "selectLight" = "default"
   export let start: Point
   export let end: Point
   export let flip: boolean = false
   $: v = end.displacementFrom(start).normalized().scaledBy(4)
</script>

{#if renderType === "default"}
   <!-- Add little "wings" to the ends of the hopover. -->
   <path
      class="fluidLine {renderType}"
      d="M{start.x - v.x},{start.y -
         v.y} L{start.x},{start.y} A 7.5,7.5 0 0 {+flip} {end.x},{end.y} L{end.x +
         v.x},{end.y + v.y}"
   />
{:else}
   <!-- Draw the highlight/selection without wings. -->
   <path
      class="fluidLine {renderType}"
      d="M{start.x},{start.y} A 7.5,7.5 0 0 {+flip} {end.x},{end.y}"
   />
{/if}

<style>
   .default {
      stroke-width: 3px;
   }
   .highlight,
   .selectLight {
      stroke-width: 9px;
   }
</style>
