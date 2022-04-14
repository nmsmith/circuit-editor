<script lang="ts">
   import type { Point } from "./math"
   export let position: Point
   export let highlighted: boolean = false
</script>

{#if highlighted}
   <circle class="highlight" cx={position.x} cy={position.y} r={7} />
{/if}
<circle class="endpoint" cx={position.x} cy={position.y} r={4} />

<style>
   .endpoint {
      fill: black;
   }
</style>
