<script lang="ts">
   import type { Point, Range2D, Rotation } from "~/shared/geometry"

   export let range: Range2D
   export let position: Point
   export let rotation: Rotation
   export let fontSize: number
   export let text: string
   export let render: "box" | "highlight" = "box"
   export let shadeBackground = false

   let className: string
   $: {
      className = render
      if (text === "" && shadeBackground) className += " shaded"
   }
   const xPad = 2
</script>

<g
   transform="translate({position.x} {position.y}) rotate({rotation.toDegrees()})"
>
   <rect
      class={className}
      x={range.x.low - xPad}
      y={range.y.low}
      width={range.width() + 2 * xPad}
      height={range.height()}
   />
   <text style="font-size: {fontSize}px;">{text}</text>
</g>

<style>
   .box {
      stroke: none;
      fill: none;
   }
   .shaded.box {
      fill: #0003;
   }
   .highlight {
      stroke: none;
      fill: currentColor;
   }
   text {
      font-family: "Source Sans";
   }
</style>
