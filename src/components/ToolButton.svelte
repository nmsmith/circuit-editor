<script lang="ts">
   import type { Point } from "~/shared/geometry"
   export let label: string
   export let x: number
   export let y: number
   export let size: number
   export let active: boolean
</script>

<rect
   class={active ? "active" : "not-active"}
   {x}
   {y}
   width={size}
   height={size}
/>
<text class="capital" x={x + 4} y={y + 16}>{label[0]}</text>
<text class="rest" x={x + 16} y={y + 16}>{label.slice(1)}</text>

<style>
   .active {
      fill: white;
      stroke: black;
      stroke-width: 1px;
   }
   .not-active {
      fill: lightgrey;
      stroke: black;
      stroke-width: 1px;
   }
   text {
      user-select: none;
      -webkit-user-select: none;
   }
   text.capital {
      font: bold 18px "Courier", monospace;
   }
   text.rest {
      font: 12px "Monaco", monospace;
   }
</style>
