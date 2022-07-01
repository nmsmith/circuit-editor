<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let renderStyle: "default" | "hover" | "select" | "debug" = "default"
   export let position: Point
</script>

<circle
   class="fluid {renderStyle} fill"
   cx={position.x}
   cy={position.y}
   r={renderStyle === "default" ? 6 : 9.5}
/>

<style>
</style>
