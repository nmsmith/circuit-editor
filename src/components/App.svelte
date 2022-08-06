<script lang="ts">
   import type { SymbolKind } from "~/shared/definitions"
   import { Vector, Point, Range1D, Range2D } from "~/shared/geometry"
   import { mouseInCoordinateSystemOf } from "~/shared/utilities"
   import CircuitView from "~/components/CircuitView.svelte"
   // State
   let mouse: Point = Point.zero
   let client: Point = Point.zero

   // Definitions passed to CircuitView
   // function onSymbolLeave() {}

   // Definitions obtained from circuitView
   let buttonMap: any
   let buttonForSidebarDragging: any
   let onSymbolEnter: (
      kind: SymbolKind,
      grabOffset: Vector,
      event: MouseEvent,
      draggingUsingLMB: boolean
   ) => void

   // Data related to schematic symbols
   let symbolFiles = [
      "/symbols/animate/pump.svg",
      "/symbols/animate/valve.svg",
      "/symbols/illustrator/limit switch.svg",
      "/symbols/illustrator/prox sensor.svg",
   ]
   let symbolKinds: SymbolKind[] = []
   let grabbedSymbol: { kind: SymbolKind; grabOffset: Vector } | null = null
   let mouseEvents = new Map<EventTarget, MouseEvent>()

   // Pre-process the SVG (already in the DOM) of the schematic symbol whose
   // file path is given.
   function registerSymbolKind(filePath: string) {
      let object = document.getElementById(filePath) as HTMLObjectElement
      let svgDocument = object.contentDocument
      if (svgDocument && svgDocument.firstChild?.nodeName === "svg") {
         let svg = svgDocument.firstChild as SVGElement
         // Compute the bounding box of the whole SVG.
         let svgBox
         {
            svg.getBoundingClientRect() // hack to fix Safari's calculations
            let { x, y, width, height } = svg.getBoundingClientRect()
            svgBox = Range2D.fromXY(
               new Range1D(x, x + width),
               new Range1D(y, y + height)
            )
         }
         // Locate the collision box and ports of the symbol.
         let collisionBox
         let portLocations = []
         for (let element of svg.querySelectorAll("[id]")) {
            if (element.id === "collisionBox") {
               let { x, y, width, height } = element.getBoundingClientRect()
               collisionBox = Range2D.fromXY(
                  new Range1D(x, x + width),
                  new Range1D(y, y + height)
               )
            } else if (element.id.endsWith("Snap")) {
               let { x, y, width, height } = element.getBoundingClientRect()
               portLocations.push(new Point(x + width / 2, y + height / 2))
            }
         }
         // If the symbol has no defined collision box, use the SVG's box.
         if (!collisionBox) collisionBox = svgBox
         // Add the symbol to the app's list of symbols.
         symbolKinds = [
            ...symbolKinds,
            { filePath, svgTemplate: svg, svgBox, collisionBox, portLocations },
         ]
      }
   }
   function absolutePosition(p: Point) {
      return `position: absolute; left: ${p.x}px; top: ${p.y}px`
   }
</script>

<svelte:window
   on:keydown={(event) => {
      // If the key pressed corresponds to the key for moving symbols in the
      // editor, simulate a mousedown event so that the symbol can be dragged.
      if (event.repeat) return // Ignore repeated events from held-down keys.
      if (buttonMap[event.code] !== buttonForSidebarDragging) return
      let symbolUnderMouse = document.elementFromPoint(client.x, client.y)
      if (!symbolUnderMouse) return
      let symbolMouseEvent = mouseEvents.get(symbolUnderMouse)
      if (!symbolMouseEvent) return
      symbolUnderMouse.dispatchEvent(
         new MouseEvent("mousedown", symbolMouseEvent)
      )
   }}
   on:keyup={(event) => {
      if (event.repeat) return // Ignore repeated events from held-down keys.
      if (buttonMap[event.code] !== buttonForSidebarDragging) return
      grabbedSymbol = null
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
      client = new Point(event.clientX, event.clientY)
   }}
>
   <CircuitView
      bind:buttonMap
      bind:buttonForSidebarDragging
      bind:onSymbolEnter
   />
   <div
      class="symbolPane"
      on:mouseup={() => {
         grabbedSymbol = null
      }}
      on:mouseleave={(event) => {
         let leftMouseIsDown = (event.buttons & 0b001) !== 0
         if (grabbedSymbol) {
            onSymbolEnter(
               grabbedSymbol.kind,
               grabbedSymbol.grabOffset,
               event,
               leftMouseIsDown
            )
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
            on:mousemove={(event) => {
               // Store the "mousemove" event so that it can later be used to
               // simulate a "mousedown" event with the right metadata!
               if (event.target) mouseEvents.set(event.target, event)
            }}
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
   :global(.fluid.line) {
      stroke-linejoin: round;
      stroke-linecap: round;
   }
   :global(.fluid.stroke) {
      stroke: blue;
      fill: none;
   }
   :global(.fluid.fill) {
      fill: blue;
   }
   :global(.relaxed.stroke) {
      stroke: rgb(0, 140, 75);
      fill: none;
   }
   :global(.relaxed.fill) {
      fill: rgb(0, 140, 75);
   }
   :global(.hover.stroke) {
      stroke: rgb(0, 234, 255);
      fill: none;
   }
   :global(.hover.fill) {
      fill: rgb(0, 234, 255);
   }
   :global(.select.stroke) {
      stroke: white;
      fill: none;
   }
   :global(.select.fill) {
      fill: white;
   }
   :global(.debug.stroke) {
      stroke: #e58a00;
      fill: none;
   }
   :global(.debug.fill) {
      fill: #e58a00;
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
   /* .toolText {
      position: absolute;
      left: 8px;
      top: 8px;
      font: 20px sans-serif;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
   } */
</style>
