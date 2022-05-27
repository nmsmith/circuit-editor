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

<div
   id="app"
   on:contextmenu={(event) => {
      // Disable the context menu.
      event.preventDefault()
      return false
   }}
>
   <CircuitView {tool} {shift} {alt} {cmd} bind:onDelete>
      <div class="componentPane">
         <div class="paneTitle">Components</div>
         <img src="/symbols/animate/pump.svg" alt="pump" />
         <img src="/symbols/animate/valve.svg" alt="valve" />
      </div>
   </CircuitView>
   <div class="toolText">{tool}</div>
</div>

<style>
   :global(html, body, #app) {
      height: 100%;
      margin: 0;
      overflow: hidden;
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
   .paneTitle {
      font: bold 24px sans-serif;
      margin-bottom: 12px;
   }
   .componentPane {
      position: fixed; /* N.B: This overcomes a bug in Safari's layout. */
      margin-left: 8px; /* This gives room for the drop shadow to render. */
      width: 100%;
      height: 100%;
      background-color: rgb(231, 234, 237);
      box-shadow: 0 0 8px 0 rgb(0, 0, 0, 0.2);
      padding: 8px;
      overflow-x: scroll;
      overflow-y: scroll;
      user-select: none;
      -webkit-user-select: none;
   }
   .componentPane > img {
      margin: 4px;
   }
   .toolText {
      position: absolute;
      left: 8px;
      top: 8px;
      font: 20px sans-serif;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
   }
</style>
