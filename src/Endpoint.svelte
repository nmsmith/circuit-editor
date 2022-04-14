<script lang="ts">
   import type { Point } from "./math"
   export let position: Point
   export let highlighted: boolean = false
</script>

{#if highlighted}
   <circle class="highlight" cx={position.x} cy={position.y} r={8} />
{/if}
<circle class="fluidLine" cx={position.x} cy={position.y} r={6} />

<style>
</style>
