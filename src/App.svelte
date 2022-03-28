<script lang="ts">
   let mouse = { x: 0, y: 0 }
</script>

<svg
   on:mousemove={(event) => {
      mouse.x = event.clientX
      mouse.y = event.clientY
   }}
>
   <text x={mouse.x} y={mouse.y}>
      The mouse position is {mouse.x} x {mouse.y}
   </text>
</svg>

<style>
   :global(html, body, #app) {
      height: 100%;
      margin: 0px;
   }
   svg {
      width: 100%;
      height: 100%;
      fill: green;
   }
</style>
