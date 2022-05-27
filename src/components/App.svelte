<script lang="ts">
   import type { Tool } from "~/shared/definitions"
   import CircuitView from "~/components/CircuitView.svelte"
   // State passed to CircuitView
   let tool: Tool = "hydraulic line"
   let [shift, alt, cmd] = [false, false, false]
   // State obtained from circuitView
   let onDelete: () => void

   function updateModifierKeys(event: KeyboardEvent | MouseEvent) {
      shift = event.getModifierState("Shift")
      alt = event.getModifierState("Alt")
      cmd = event.getModifierState("Control") || event.getModifierState("Meta")
   }
</script>

<div
   id="app"
   on:contextmenu={(event) => {
      // Disable the context menu.
      event.preventDefault()
      return false
   }}
>
   <CircuitView {tool} {shift} {alt} {cmd} bind:onDelete />
   <div class="toolText">{tool}</div>
</div>

<svelte:window
   on:mousemove={updateModifierKeys}
   on:keydown={(event) => {
      updateModifierKeys(event)
      switch (event.key) {
         case "s":
         case "S":
            tool = "select & move"
            break
         case "f":
         case "F":
            tool = "hydraulic line"
            break
         case "Backspace":
         case "Delete": {
            onDelete()
            break
         }
      }
   }}
   on:keyup={updateModifierKeys}
   on:blur={() => {
      shift = false
      alt = false
      cmd = false
   }}
/>

<style>
   :global(html, body, #app) {
      height: 100%;
      margin: 0;
   }
   :global(.fluidLine) {
      fill: none;
      stroke: blue;
      stroke-linejoin: round;
      stroke-linecap: round;
      stroke-width: 0;
   }
   :global(.fluidLine.highlight) {
      stroke: rgb(0, 234, 255);
   }
   :global(.fluidLine.selectLight) {
      stroke: yellow;
   }
   .toolText {
      position: absolute;
      left: 8px;
      top: 8px;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
      font: 20px sans-serif;
   }
</style>
