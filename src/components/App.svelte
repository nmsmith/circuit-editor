<script lang="ts">
   import type { Tool, SymbolKind } from "~/shared/definitions"
   import { Vector, Point, Range1D, Range2D } from "~/shared/geometry"
   import { mouseInCoordinateSystemOf } from "~/shared/utilities"
   import CircuitView from "~/components/CircuitView.svelte"
   // State
   let mouse: Point = Point.zero

   // State passed to CircuitView
   let tool: Tool = "hydraulic line"
   let [shift, alt, cmd] = [false, false, false]
   function onSymbolLeave() {}

   // Callbacks obtained from circuitView
   let onToolChanged: (newTool: Tool) => void
   let onDelete: () => void
   let onSymbolEnter: (
      kind: SymbolKind,
      grabOffset: Vector,
      event: MouseEvent
   ) => void
   $: onToolChanged ? onToolChanged(tool) : {} // Called when the tool changes.

   // Data related to schematic symbols
   let symbolFiles = ["/symbols/animate/pump.svg", "/symbols/animate/valve.svg"]
   let symbolKinds: SymbolKind[] = []
   let grabbedSymbol: { kind: SymbolKind; grabOffset: Vector } | null = null

   // Pre-process the SVG (already in the DOM) of the schematic symbol whose
   // file path is given.
   function registerSymbolKind(filePath: string) {
      let object = document.getElementById(filePath) as HTMLObjectElement
      let svgDocument = object.contentDocument
      if (svgDocument && svgDocument.firstChild?.nodeName === "svg") {
         let svg = svgDocument.firstChild as SVGElement
         // Locate the bounding box and ports of the symbol.
         let boundingBox
         let portLocations = []
         for (let element of svg.querySelectorAll("*")) {
            if (element.hasAttribute("id")) {
               if (element.id === "boundingBox") {
                  let { x, y, width, height } = element.getBoundingClientRect()
                  boundingBox = Range2D.fromXY(
                     new Range1D(x, x + width),
                     new Range1D(y, y + height)
                  )
               } else if (element.id.endsWith("Snap")) {
                  let { x, y, width, height } = element.getBoundingClientRect()
                  portLocations.push(new Point(x + width / 2, y + height / 2))
               }
            }
         }
         // If the symbol has no defined bounding box, create a default one.
         if (!boundingBox) {
            let { x, y, width, height } = svg.getBoundingClientRect()
            boundingBox = Range2D.fromXY(
               new Range1D(x, x + width),
               new Range1D(y, y + height)
            )
         }
         // Add the symbol to the app's list of symbols.
         symbolKinds = [
            ...symbolKinds,
            { filePath, svgTemplate: svg, boundingBox, portLocations },
         ]
      }
   }
   function absolutePosition(p: Point) {
      return `position: absolute; left: ${p.x}px; top: ${p.y}px`
   }
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
   on:mousemove={(event) => {
      mouse = mouseInCoordinateSystemOf(event.currentTarget, event)
   }}
>
   <CircuitView
      {shift}
      {alt}
      {cmd}
      {onSymbolLeave}
      bind:onToolChanged
      bind:onDelete
      bind:onSymbolEnter
   />
   <div class="toolText">{tool}</div>
   <div
      class="symbolPane"
      on:mouseup={() => {
         grabbedSymbol = null
      }}
      on:mouseleave={(event) => {
         if (grabbedSymbol) {
            onSymbolEnter(grabbedSymbol.kind, grabbedSymbol.grabOffset, event)
            grabbedSymbol = null
         }
      }}
   >
      <div class="paneTitle">Symbols</div>
      {#each symbolKinds as kind}
         <img
            src={kind.filePath}
            alt=""
            style="visibility: {kind.filePath === grabbedSymbol?.kind.filePath
               ? 'hidden'
               : 'visible'}"
            on:mousedown={(event) => {
               grabbedSymbol = {
                  kind,
                  grabOffset: new Vector(-event.offsetX, -event.offsetY),
               }
            }}
         />
      {/each}
   </div>
   {#if grabbedSymbol}
      <img
         class="grabbedSymbolImage"
         src={grabbedSymbol.kind.filePath}
         alt=""
         style={absolutePosition(mouse.displacedBy(grabbedSymbol.grabOffset))}
      />
   {/if}
</div>
<div id="resources" style="visibility: hidden">
   <!-- Load each kind of symbol as an invisible <object>, and pre-process it
   as necessary. We will clone an <object>'s DOM content when the corresponding
   symbol needs to be instantiated on the main drawing canvas. -->
   <!-- N.B: display:none doesn't work: it prevents the objects from loading.-->
   {#each symbolFiles as filePath}
      <object
         id={filePath}
         type="image/svg+xml"
         data={filePath}
         title=""
         on:load={() => registerSymbolKind(filePath)}
      />
   {/each}
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
      cursor: default;
   }
   .symbolPane {
      position: absolute;
      top: 0;
      right: 0;
      width: 200px;
      height: 100%;
      overflow: scroll;
      background-color: rgb(231, 234, 237);
      box-shadow: 0 0 8px 0 rgb(0, 0, 0, 0.2);
      padding: 8px;
      user-select: none;
      -webkit-user-select: none;
   }
   .symbolPane > img {
      margin: 4px;
   }
   .grabbedSymbolImage {
      pointer-events: none;
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
