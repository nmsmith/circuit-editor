<script lang="ts">
   import { onMount } from "svelte"
   import {
      Vertex,
      isVertex,
      Edge,
      Junction,
      Port,
      Segment,
      CrossingType,
      Crossing,
      SymbolKind,
      SymbolInstance,
      convertToJunction,
   } from "~/shared/definitions"
   import {
      rememberAxis,
      Object2D,
      Vector,
      Point,
      Rotation,
      Direction,
      Axis,
      Line,
      Range1D,
      Range2D,
      ClosenessResult,
      closestTo,
      closestSegmentTo,
   } from "~/shared/geometry"
   import * as Geometry from "~/shared/geometry"
   import { DefaultMap } from "~/shared/utilities"
   import FluidLine from "~/components/lines/FluidLine.svelte"
   import Hopover from "~/components/lines/Hopover.svelte"
   import JunctionNode from "~/components/lines/JunctionNode.svelte"
   import PointMarker from "~/components/PointMarker.svelte"
   import RectSelectBox from "~/components/RectSelectBox.svelte"
   import Plug from "~/components/lines/Plug.svelte"
   import Button from "~/components/ToolButton.svelte"
   import Heap from "heap"

   // ------------------------------ Constants --------------------------------
   const symbolFilesForBrowserTesting: string[] = [
      "limit switch.svg",
      "prox sensor.svg",
      "pump.svg",
      "valve.svg",
   ]
   let canvas: SVGElement | undefined // the root element of this component
   const row1Tools = ["query", "warp", "erase", "rigid", "tether"] as const
   const row2Tools = ["aButton", "slide", "draw", "flex", "gButton"] as const
   const tools = [...row1Tools, ...row2Tools] as const
   type Tool = typeof tools[number]
   type Operation = Tool | "pan"
   // Input constants
   const panSpeed = 1.5 // when panning with trackpad
   const pinchZoomSpeed = 0.02
   const wheelZoomSpeed = 0.14
   const minZoom = 0.1
   const maxZoom = 20
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   const infinityVector = new Vector(Infinity, Infinity)
   // Circuit-sizing constants (zoom-independent)
   const sqMinSegmentLength = 15 ** 2
   const standardGap = 30 // standard spacing between circuit elements
   const halfGap = 15
   const slidePad = halfGap / 2 // dist at which close-passing elements collide
   const hopoverRadius = halfGap / 2
   // Zoom-dependent constants
   const sqShortDragDelay = 8 ** 2
   const sqLongDragDelay = 16 ** 2
   const easeRadius = 30 // dist btw mouse & snap point at which easing begins
   const snapRadius = 12 // dist btw mouse & snap point at which snapping occurs
   const snapJump = 5 // the distance things move at the moment they snap
   const sqEaseRadius = easeRadius ** 2
   const sqSnapRadius = snapRadius ** 2
   const sqInteractRadius = sqSnapRadius
   // The major axes that drawing occurs along.
   const primaryAxes = [Axis.horizontal, Axis.vertical]
   const snapAxes = [
      Axis.horizontal,
      Axis.vertical,
      Axis.fromRadians(0.125 * tau), // 45 degrees
      Axis.fromRadians(0.375 * tau), // 135 degrees
   ]
   snapAxes.forEach(rememberAxis)
   // The toggle order of the glyphs that appear at crossings.
   const crossingToggleSeq: CrossingType[] = [
      "no hop",
      "V right",
      "H down",
      "V left",
      "H up",
   ]

   // ---------------------- Supplementary definitions ------------------------
   type Highlightable = Point | Segment | SymbolInstance
   type Attachable = Vertex | Segment // Something a segment can be attached to.
   type Toggleable = Vertex | Segment | Crossing
   type Grabbable = Junction | Segment | SymbolInstance
   type Movable = Junction | SymbolInstance // Things that move when dragged.
   type Pushable = Junction | Segment | SymbolInstance
   function isMovable(thing: any): thing is Movable {
      return thing instanceof Junction || thing instanceof SymbolInstance
   }
   function movableAt(vertex: Vertex): Movable {
      return vertex instanceof Junction ? vertex : vertex.symbol
   }
   function movablesOf(grabbable: Grabbable): Set<Movable> {
      return isMovable(grabbable)
         ? new Set([grabbable])
         : new Set([movableAt(grabbable.start), movableAt(grabbable.end)])
   }
   function* allVertices(): Generator<Vertex> {
      for (let v of Junction.s) yield v
      for (let v of Port.s) yield v
   }
   function* allCrossings(): Generator<Crossing> {
      for (let [seg1, map] of crossingMap) {
         for (let [seg2, point] of map) yield new Crossing(seg1, seg2, point)
      }
   }
   function* allMovables(): Generator<Movable> {
      for (let m of Junction.s) yield m
      for (let m of SymbolInstance.s) yield m
   }
   function* allPushables(): Generator<Pushable> {
      for (let p of Junction.s) yield p
      for (let p of Segment.s) yield p
      for (let p of SymbolInstance.s) yield p
   }
   function closestNearTo<T extends Object2D>(
      point: Point,
      ...objectSets: Iterable<T>[]
   ): ClosenessResult<T> {
      let closest = closestTo(point, ...objectSets)
      if (
         closest &&
         closest.closestPart.sqDistanceFrom(point) < sqInteractRadius
      ) {
         return closest
      }
   }
   function closestSegmentNearTo(
      point: Point,
      alongAxis: Axis,
      segments: Iterable<Segment> = Segment.s
   ): ClosenessResult<Segment> {
      let closest = closestSegmentTo(point, alongAxis, segments)
      let sqBuffer = hopoverRadius * hopoverRadius
      if (
         closest &&
         closest.closestPart.sqDistanceFrom(point) < sqInteractRadius &&
         closest.closestPart.sqDistanceFrom(closest.object.start) >= sqBuffer &&
         closest.closestPart.sqDistanceFrom(closest.object.end) >= sqBuffer
      ) {
         return closest
      }
   }
   function closestAttachable(point: Point): ClosenessResult<Attachable> {
      return (
         closestNearTo(point, allVertices()) || closestNearTo(point, Segment.s)
      )
   }
   function closestToggleable(point: Point): ClosenessResult<Toggleable> {
      return (
         closestNearTo<Vertex | Crossing>(
            point,
            allVertices(),
            allCrossings()
         ) || closestNearTo(point, Segment.s)
      )
   }
   function closestAttachableOrToggleable(
      point: Point
   ): ClosenessResult<Attachable | Toggleable> {
      // This additional function is necessary because the individual functions
      // don't compose.
      return (
         closestNearTo<Vertex | Crossing>(
            point,
            allVertices(),
            allCrossings()
         ) || closestNearTo(point, Segment.s)
      )
   }
   function closestGrabbable(point: Point): ClosenessResult<Grabbable> {
      return (
         closestNearTo(point, Junction.s) ||
         closestNearTo(point, SymbolInstance.s) ||
         closestNearTo(point, Segment.s)
      )
   }
   function closestMovable(point: Point): ClosenessResult<Movable> {
      return (
         closestNearTo(point, Junction.s) ||
         closestNearTo(point, SymbolInstance.s)
      )
   }
   // ✨ A magical easing function for aesthetically-pleasing snapping. The
   // source is displaced from its true position as it approaches the target.
   function easeFn(distance: number): number {
      const a =
         (snapRadius - snapJump) /
         (sqSnapRadius + sqEaseRadius - 2 * snapRadius * easeRadius)
      const b = -2 * a * easeRadius
      const c = -a * sqEaseRadius - b * easeRadius
      return a * distance * distance + b * distance + c
   }
   function layerOf(point: Point): "lower" | "upper" {
      return point instanceof Port || point === draw?.segment.end
         ? "upper"
         : "lower"
   }
   function shouldExtendTheSegmentAt(
      junction: Junction,
      drawAxis: Axis
   ): boolean {
      return junction.edges().size === 1 && junction.axes()[0] === drawAxis
   }
   function nearestAxis(to: Axis, ofAxes: Axis[]): Axis {
      if (ofAxes.length === 0) return to
      let scores = ofAxes.map((axis) => Math.abs(to.dot(axis)))
      return ofAxes[scores.indexOf(Math.max(...scores))]
   }
   function selectedDrawMode(): DrawMode {
      return keyInfo.read(Shift).pressing
         ? config.angleSnap.state === "on"
            ? "snapped rotation"
            : "free rotation"
         : "strafing"
   }
   function selectedSlideMode(): SlideMode {
      return keyInfo.read(Shift).pressing ? "push connected" : "push all"
   }
   function selectedWarpMode(): WarpMode {
      return keyInfo.read(Shift).pressing ? "rotate" : "pan"
   }
   function labelOfButton(s: string): string {
      if (s.endsWith("Button")) return s[0].toUpperCase()
      else return s[0].toUpperCase() + s.slice(1)
   }
   function copyPositions(): DefaultMap<Movable, Point> {
      let positions = new DefaultMap<Movable, Point>(() => Point.zero)
      for (let j of Junction.s) positions.set(j, j.clone())
      for (let s of SymbolInstance.s) positions.set(s, s.position.clone())
      return positions
   }
   function copySymbolDirections(): DefaultMap<SymbolInstance, Direction> {
      let directions = new DefaultMap<SymbolInstance, Direction>(
         () => Direction.positiveX
      )
      for (let symbol of SymbolInstance.s)
         directions.set(symbol, symbol.direction)
      return directions
   }
   // Returns the "shadow" each circuit element casts onto the given vector.
   // Only circuit elements parallel or orthogonal to the vector are considered.
   function projectionOfCircuitOnto(
      vector: Vector,
      pad: number = 0
   ): Map<Pushable, Range1D> {
      if (vector.sqLength() === 0) return new Map()

      let ranges = new Map<Pushable, Range1D>()
      let vectorAxis = Axis.fromVector(vector) as Axis
      let axesConsidered = [vectorAxis, vectorAxis.orthogonal()]

      for (let junction of Junction.s) {
         let s = junction
            .displacementFrom(Point.zero)
            .scalarProjectionOnto(vector)
         ranges.set(junction, new Range1D([s], pad))
      }
      for (let segment of Segment.s) {
         if (axesConsidered.includes(segment.axis))
            ranges.set(
               segment,
               new Range1D(
                  [
                     segment.start
                        .displacementFrom(Point.zero)
                        .scalarProjectionOnto(vector),
                     segment.end
                        .displacementFrom(Point.zero)
                        .scalarProjectionOnto(vector),
                  ],
                  pad
               )
            )
      }
      for (let symbol of SymbolInstance.s) {
         let symbolAxis = Axis.fromDirection(symbol.direction)
         if (axesConsidered.includes(symbolAxis))
            ranges.set(symbol, rangeAlong(vector, symbol))
      }
      function rangeAlong(dir: Vector, symbol: SymbolInstance): Range1D {
         return new Range1D(
            symbol
               .corners()
               .map((corner) =>
                  corner.displacementFrom(Point.zero).scalarProjectionOnto(dir)
               ),
            pad
         )
      }
      return ranges
   }
   function absolutePosition(p: Point) {
      return `position: absolute; left: ${p.x}px; top: ${p.y}px`
   }
   $: windowCoordsToCanvasCoords = (p: Point): Point => {
      let offset = p.displacementFrom(canvasCenter).scaledBy(1 / cameraZoom)
      return cameraPosition.displacedBy(offset)
   }
   $: canvasCoordsToWindowCoords = (p: Point): Point => {
      let offset = p.displacementFrom(cameraPosition).scaledBy(cameraZoom)
      return canvasCenter.displacedBy(offset)
   }
   function isMouseWheel(event: WheelEvent): boolean {
      // NOTE: This is a "trick" that only works in Chrome. There is no cross-
      // browser way to distinguish mouse scrolling from trackpad scrolling.
      let dy: number = (event as any).wheelDeltaY
      return event.deltaX === 0 && dy !== 0 && dy % 120 === 0 && !event.ctrlKey
   }
   function mouseWheelIncrements(event: WheelEvent): number {
      return (event as any).wheelDeltaY / 120
   }
   function executeZoom(magnitude: number) {
      let newZoom = cameraZoom * 2 ** magnitude
      newZoom = Math.max(minZoom, Math.min(newZoom, maxZoom))
      let zoomFactor = newZoom / cameraZoom
      // Zoom towards the mouse position.
      cameraZoom = newZoom
      committedCameraPosition = committedCameraPosition.displacedBy(
         mouseOnCanvas
            .displacementFrom(cameraPosition)
            .scaledBy((zoomFactor - 1) / zoomFactor)
      )
   }
   function filePathOfSymbol(fileName: string) {
      if (usingElectron && projectFolder) {
         return "file://" + path.join(projectFolder, "symbols", fileName)
      } else {
         return `symbols/${fileName}`
      }
   }

   // ---------------------- State of input peripherals -----------------------
   let mouseInClient: Point = Point.zero
   const [LMB, RMB, Shift, Alt, Control] = [
      "LMB",
      "RMB",
      "Shift",
      "Alt",
      "Control",
   ]
   let keyInfo = new DefaultMap<
      string,
      (
         | { type: "none" | "pan" | "useTool" }
         | { type: "holdTool"; tool: Tool }
      ) & {
         pressing: boolean
      }
   >(() => {
      return { type: "none", pressing: false }
   }, [
      [RMB, { type: "pan", pressing: false }],
      ["Space", { type: "pan", pressing: false }],
      ["KeyQ", { type: "holdTool", tool: "query", pressing: false }],
      ["KeyW", { type: "holdTool", tool: "warp", pressing: false }],
      ["KeyE", { type: "holdTool", tool: "erase", pressing: false }],
      ["KeyR", { type: "holdTool", tool: "rigid", pressing: false }],
      ["KeyT", { type: "holdTool", tool: "tether", pressing: false }],
      ["KeyA", { type: "holdTool", tool: "aButton", pressing: false }],
      ["KeyS", { type: "holdTool", tool: "slide", pressing: false }],
      ["KeyD", { type: "holdTool", tool: "draw", pressing: false }],
      ["KeyF", { type: "holdTool", tool: "flex", pressing: false }],
      ["KeyG", { type: "holdTool", tool: "gButton", pressing: false }],
      [LMB, { type: "useTool", pressing: false }],
   ])

   // ------------------------- Primary editor state --------------------------
   // Note: This is the state of the editor. The circuit is stored elsewhere.
   let projectFolder: null | string = null
   let symbolFiles: null | string[] = []
   // If we're not using Electron, use dummy symbols.
   let usingElectron: boolean
   try {
      fileSystem
      usingElectron = true
   } catch {
      usingElectron = false
      symbolFiles = symbolFilesForBrowserTesting
   }

   let symbolKinds: SymbolKind[] = []
   let grabbedSymbol: { kind: SymbolKind; grabOffset: Vector } | null = null

   const onAndOff = ["on", "off"] as const
   type OnOrOff = typeof onAndOff[number]
   const stdHalfAndOff = [standardGap, halfGap, "off"] as const
   type StdHalfOrOff = typeof stdHalfAndOff[number]
   let config = {
      distanceSnap: {
         tooltip: "Snap to a standard distance?",
         icon: "icons/distanceSnap.svg",
         values: stdHalfAndOff,
         state: standardGap as StdHalfOrOff,
      },
      distanceWarn: {
         tooltip: "Warn when distances are slightly askew?",
         icon: "icons/distanceWarn.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
      angleSnap: {
         tooltip: "Snap to common angles?",
         icon: "icons/angleSnap.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
      angleWarn: {
         tooltip: "Warn when angles are slightly askew?",
         icon: "icons/angleWarn.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
      showSymbolSnaps: {
         tooltip: "Display ports and collision boxes?",
         icon: "icons/symbolSnaps.svg",
         values: onAndOff,
         state: "off" as OnOrOff,
      },
      placeholder: {
         tooltip: "Placeholder.",
         icon: "icons/targetSnap.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
   }
   function toggleConfig(item: typeof config[keyof typeof config]) {
      let i = item.values.indexOf(item.state as any)
      item.state = item.values[(i + 1) % item.values.length]
      config = config // Inform Svelte of change.
   }

   let committedCameraPosition: Point = Point.zero // Position on the canvas.
   let cameraZoom: number = 1

   // The "boundTool" is the tool that will be used when no keyboard keys of
   // type "holdTool" are being pressed.
   let boundTool: Tool = "draw"
   // When a "holdTool" key is pressed, it assigns a "heldTool". When the key
   // is released, "heldTool" is reset to null.
   let heldTool: null | { tool: Tool; shouldBind: boolean } = null
   // If there is a "heldTool", use that. Otherwise, use the "boundTool".
   $: toolToUse = heldTool ? heldTool.tool : boundTool
   // The tool of the operation currently in-progress (if any).
   let toolBeingUsed: null | {
      tool: Tool
      canvasDownPosition: Point
      chainDrawFromEnd?: Junction // Special field for the draw tool.
   } = null

   let pan: null | { clientDownPosition: Point } = null
   type DrawMode = "strafing" | "snapped rotation" | "free rotation"
   let draw: null | {
      mode: DrawMode
      segment: Segment
      end: Junction
      segmentIsNew: boolean
      endObject?: Attachable
      drawAxisRanges?: Map<Pushable, Range1D>
      orthoRanges?: Map<Pushable, Range1D>
   }
   type SlideInstruction = {
      movable: Movable
      delay: number
      isPush: boolean
   }
   type SlideMode = "push connected" | "push all"
   let slide: null | {
      mode: SlideMode
      originalPositions: DefaultMap<Movable | Vertex, Point>
      grabbed: Grabbable
      start: Point
      axis: Axis
      posInstructions: SlideInstruction[]
      negInstructions: SlideInstruction[]
      contactPositions: number[]
   } = null
   type WarpMode = "pan" | "rotate"
   let warp: null | {
      mode: WarpMode
      movables: Set<Movable>
      centroid: Point
      keyRotations: Set<Rotation>
      incidentEdges: Set<Edge>
      originalPositions: DefaultMap<Movable, Point>
      originalDirections: DefaultMap<SymbolInstance, Direction>
      start: Point
   }
   let multiSelect: null | {
      mode: "new" | "add" | "remove"
      start: Point
      items: Set<Grabbable>
   } = null
   type SelectOperation<T> = null | {
      start: Point
      items: Set<T>
   }
   let eraseSelect: SelectOperation<Grabbable>
   $: {
      for (let symbol of SymbolInstance.s)
         symbol.svg.style.visibility = eraseSelect?.items.has(symbol)
            ? "hidden"
            : "visible"
   }
   let rigidSelect: SelectOperation<Segment>
   let flexSelect: SelectOperation<Segment>

   // ---------------------------- Derived state ------------------------------
   $: canvasWidth = canvas ? canvas.getBoundingClientRect().width : 0
   $: canvasHeight = canvas ? canvas.getBoundingClientRect().height : 0
   $: canvasCenter = new Point(canvasWidth / 2, canvasHeight / 2)
   $: computeCameraPosition = (): Point => {
      // This function is an indirection (a hack) for allowing `cameraPosition`
      // to be updated reactively AND manually.
      if (pan) {
         let d = pan.clientDownPosition
            .displacementFrom(mouseInClient)
            .scaledBy(1 / cameraZoom)
         return committedCameraPosition.displacedBy(d)
      } else {
         return committedCameraPosition
      }
   }
   $: cameraPosition = computeCameraPosition()
   $: computeMouseOnCanvas = (): Point => {
      // This function is an indirection (a hack) for allowing `mouseOnCanvas`
      // to be updated reactively AND manually.
      if (canvas) {
         let canvasRect = canvas.getBoundingClientRect()
         let positionInCanvasWindow = new Point(
            mouseInClient.x - canvasRect.left,
            mouseInClient.y - canvasRect.top
         )
         return windowCoordsToCanvasCoords(positionInCanvasWindow)
      } else {
         return Point.zero
      }
   }
   $: mouseOnCanvas = computeMouseOnCanvas()
   let svgTranslate: Vector
   $: {
      let windowTopLeft = windowCoordsToCanvasCoords(Point.zero)
      svgTranslate = new Vector(-windowTopLeft.x, -windowTopLeft.y)
   }
   let crossingMap: DefaultMap<Segment, Map<Segment, Point>>
   $: /* Determine which Segments are crossing, and where they cross. */ {
      crossingMap = new DefaultMap(() => new Map())
      for (let seg1 of Segment.s) {
         for (let seg2 of Segment.s) {
            if (seg1.connectsTo(seg2)) continue
            let crossPoint = seg1.intersection(seg2)
            if (crossPoint) {
               let ends = [seg1.start, seg1.end, seg2.start, seg2.end]
               let minDistance = Math.min(
                  ...ends.map((p) => p.distanceFrom(crossPoint as Point))
               )
               if (minDistance >= hopoverRadius + 4) {
                  crossingMap.getOrCreate(seg1).set(seg2, crossPoint)
                  crossingMap.getOrCreate(seg2).set(seg1, crossPoint)
               }
            }
         }
      }
   }
   let cursor: "default" | "cell" | "grab" | "grabbing"
   $: /* Set the appearance of the mouse cursor. */ {
      if (slide) {
         cursor = "grabbing"
      } else if (toolToUse === "slide") {
         if (closestGrabbable(mouseOnCanvas)) {
            cursor = slide ? "grabbing" : "grab"
         } else {
            cursor = "default"
         }
      } else if (multiSelect || eraseSelect || rigidSelect || flexSelect) {
         cursor = "default"
      } else {
         cursor = "cell"
      }
   }
   let hoverLight: Set<Highlightable>
   $: /* Highlight objects near the mouse cursor. */ {
      hoverLight = new Set()
      if (document.hasFocus() /* hasFocus => the mouse position is fresh */) {
         if (draw?.endObject instanceof Segment) {
            hoverLight.add(draw.endObject)
         } else if (!toolBeingUsed) {
            let thing = closestAttachableOrToggleable(mouseOnCanvas)
            if (thing) {
               if (thing.object instanceof Crossing) {
                  hoverLight.add(thing.closestPart)
               } else {
                  hoverLight.add(thing.object)
               }
            }
         }
      }
   }
   let grabLight: Set<Highlightable>
   $: {
      grabLight = new Set()
      if (draw) grabLight.add(draw.end)
      else if (warp) for (let m of warp.movables) grabLight.add(m)
      else if (slide) grabLight.add(slide.grabbed)
   }
   type HighlightStyle = "hover" | "grab" | undefined
   $: styleOf = function (thing: Highlightable): HighlightStyle {
      // This function _must_ be defined within $, because its behaviour changes
      // whenever the state below changes, and Svelte needs to know that.
      if (grabLight.has(thing)) return "grab"
      else if (hoverLight.has(thing)) return "hover"
   }
   type Section = Geometry.LineSegment<Point>
   type Glyph =
      | {
           type: "hopover"
           segment: Segment
           point: Point
           start: Point
           end: Point
           flip: boolean
           style: HighlightStyle
        }
      | { type: "junction node"; junction: Junction; style: HighlightStyle }
      | { type: "plug"; vertex: Vertex; style: HighlightStyle }
      | { type: "point marker"; point: Point; style: HighlightStyle }
   let segmentsToDraw: Map<Segment, Section[]>
   let glyphsToDraw: Set<Glyph>
   $: /* Determine which SVG elements (line segments and glyphs) to draw. */ {
      segmentsToDraw = new Map()
      glyphsToDraw = new Set()
      for (let segment of Segment.s) {
         // This array will collect the segment endpoints, and all of the
         // points at which the hopovers should be spliced into the segment.
         let points: Point[] = [segment.start, segment.end]
         for (let [other, crossPoint] of crossingMap.read(segment)) {
            // Determine which segment is the "horizontal" one.
            let segReject = segment.axis.scalarRejectionFrom(Axis.horizontal)
            let otherReject = other.axis.scalarRejectionFrom(Axis.horizontal)
            let hSegment: Segment
            if (Math.abs(segReject) < Math.abs(otherReject)) {
               hSegment = segment
            } else if (Math.abs(segReject) > Math.abs(otherReject)) {
               hSegment = other
            } else {
               hSegment = segReject < otherReject ? segment : other
            }
            // Determine which segment will hop over the other.
            let type = segment.crossingTypes.read(other)
            if (
               (hSegment === segment && (type == "H up" || type == "H down")) ||
               (hSegment === other && (type == "V left" || type == "V right"))
            ) {
               let [start, end] = [
                  crossPoint.displacedBy(segment.axis.scaledBy(hopoverRadius)),
                  crossPoint.displacedBy(segment.axis.scaledBy(-hopoverRadius)),
               ]
               points.push(start, end)
               let flip = type === "H down" || type === "V right"
               glyphsToDraw.add({
                  type: "hopover",
                  segment,
                  point: crossPoint,
                  start,
                  end,
                  flip,
                  style: styleOf(segment) || styleOf(crossPoint),
               })
            } else if (type === "no hop" && hoverLight.has(crossPoint)) {
               glyphsToDraw.add({
                  type: "point marker",
                  point: crossPoint,
                  style: styleOf(crossPoint),
               })
            }
         }
         // Compute the sections that need to be drawn.
         let distanceOf = (p: Point) => p.sqDistanceFrom(segment.start)
         points.sort((a, b) => distanceOf(a) - distanceOf(b))
         let sections: Section[] = []
         for (let i = 0; i < points.length; i += 2) {
            sections.push(
               new Geometry.LineSegment(points[i], points[i + 1], segment.axis)
            )
         }
         segmentsToDraw.set(segment, sections)
      }
      // Determine the other glyphs that need to be drawn at vertices.
      for (let v of allVertices()) {
         if (v.glyph === "plug") {
            glyphsToDraw.add({ type: "plug", vertex: v, style: styleOf(v) })
         } else if (v instanceof Junction) {
            if (v.edges().size > 2) {
               glyphsToDraw.add({
                  type: "junction node",
                  junction: v,
                  style: styleOf(v),
               })
            } else if (
               v.isStraightLine() ||
               hoverLight.has(v) ||
               grabLight.has(v)
            ) {
               glyphsToDraw.add({
                  type: "point marker",
                  point: v,
                  style: styleOf(v),
               })
            }
         } else if (v instanceof Port && hoverLight.has(v)) {
            glyphsToDraw.add({
               type: "point marker",
               point: v,
               style: styleOf(v),
            })
         }
      }
   }

   // ---------------------------- Primary events -----------------------------
   function keyPressed(name: string) {
      let key = keyInfo.getOrCreate(name)
      if (key.pressing) return // in case we missed a release
      key.pressing = true
      if (key.type === "pan") {
         pan = { clientDownPosition: mouseInClient }
      } else if (key.type === "holdTool") {
         if (
            toolBeingUsed?.tool === "draw" &&
            (key.tool === "rigid" || key.tool === "flex")
         ) {
            // Pressing rigid/flex initiates a chain draw.
            chainDraw(key.tool === "rigid")
         } else {
            // Hold the tool. If another tool is already held, it is overridden.
            heldTool = { tool: key.tool, shouldBind: true }
         }
      } else if (key.type === "useTool") {
         toolBeingUsed = { tool: toolToUse, canvasDownPosition: mouseOnCanvas }
         if (heldTool) {
            heldTool.shouldBind = false // The tool is being used temporarily.
         }
         // Actions to perform immediately:
         if (toolToUse === "rigid") {
            let segment = closestNearTo(mouseOnCanvas, Segment.s)?.object
            if (segment?.isRigid === false) {
               segment.isRigid = true
               Segment.s = Segment.s
            }
         } else if (toolToUse === "flex") {
            let segment = closestNearTo(mouseOnCanvas, Segment.s)?.object
            if (segment?.isRigid) {
               segment.isRigid = false
               Segment.s = Segment.s
            }
         }
      }
      keyInfo = keyInfo
   }
   function keyReleased(name: string) {
      let key = keyInfo.getOrCreate(name)
      if (!key.pressing) return // in case we missed a press
      key.pressing = false
      if (key.type === "pan") {
         endPan()
      } else if (key.type === "holdTool") {
         if (heldTool?.tool === key.tool) {
            if (heldTool.shouldBind) boundTool = heldTool.tool
            heldTool = null
         }
      } else if (key.type === "useTool" && toolBeingUsed) {
         switch (toolBeingUsed.tool) {
            case "warp":
               endWarp()
               grabbedSymbol = null
               break
            case "draw": {
               if (draw) {
                  endDraw()
               } else if (!toolBeingUsed.chainDrawFromEnd) {
                  drawButtonTapped()
               }
               break
            }
            case "erase":
               endEraseSelect()
               break
            case "rigid":
               endRigidSelect()
               break
            case "slide":
               endSlide()
               break
            case "flex":
               endFlexSelect()
               break
         }
         toolBeingUsed = null
      }
      keyInfo = keyInfo
   }
   function keyAborted(name: string) {
      let key = keyInfo.getOrCreate(name)
      if (!key.pressing) return // in case we missed a press
      key.pressing = false
      if (key.type === "pan") {
         endPan() // Never abort this.
      } else if (key.type === "holdTool") {
         if (heldTool?.tool === key.tool) heldTool = null
      } else if (key.type === "useTool" && toolBeingUsed) {
         // TODO: Instead of having an "abort" function for each operation, all
         // aborts should be implemented the same way: by invoking "undo".
         // (...and then setting the operation's state to "null")
         switch (toolBeingUsed.tool) {
            case "warp":
               abortWarp()
               grabbedSymbol = null
               break
            case "draw":
               abortDraw()
               break
            case "erase":
               abortEraseSelect()
               break
            case "rigid":
               abortRigidSelect()
               break
            case "slide":
               abortSlide()
               break
            case "flex":
               abortFlexSelect()
               break
         }
         toolBeingUsed = null
      }
      keyInfo = keyInfo
   }
   function updateModifierKeys(event: KeyboardEvent | MouseEvent) {
      keyInfo.getOrCreate(Shift).pressing = event.getModifierState(Shift)
      keyInfo.getOrCreate(Alt).pressing = event.getModifierState(Alt)
      keyInfo.getOrCreate(Control).pressing =
         event.getModifierState(Control) || event.getModifierState("Meta")
      if (
         (draw && draw.mode !== selectedDrawMode()) ||
         (slide && slide.mode !== selectedSlideMode())
      )
         updateDrawAndSlide()
      if (warp && warp.mode !== selectedWarpMode()) updateWarp()
   }
   let waitedOneFrameLMB = false
   let waitedOneFrameRMB = false
   function leftMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b001) !== 0
   }
   function rightMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b010) !== 0
   }
   function drawButtonTapped() {
      let toggle = closestToggleable(mouseOnCanvas)
      if (!toggle) return
      if (isVertex(toggle.object)) {
         if (toggle.object.glyph === "default") {
            toggle.object.glyph = "plug"
         } else {
            toggle.object.glyph = "default"
            if (toggle.object instanceof Junction)
               toggle.object.convertToCrossing(
                  crossingMap,
                  crossingToggleSeq[0]
               )
         }
      } else if (toggle.object instanceof Segment) {
         let cutPoint = new Junction(toggle.closestPart)
         toggle.object.splitAt(cutPoint)
         cutPoint.glyph = "plug"
      } else if (toggle.object instanceof Crossing) {
         // Change the crossing glyph.
         let { seg1, seg2 } = toggle.object
         let oldType = seg1.crossingTypes.read(seg2)
         let i = crossingToggleSeq.indexOf(oldType) + 1
         if (i < crossingToggleSeq.length) {
            seg1.crossingTypes.set(seg2, crossingToggleSeq[i])
            seg2.crossingTypes.set(seg1, crossingToggleSeq[i])
         } else {
            convertToJunction(toggle.object)
         }
      }
      Junction.s = Junction.s
      Segment.s = Segment.s
      Port.s = Port.s
   }
   function mouseMoved() {
      cameraPosition = computeCameraPosition()
      mouseOnCanvas = computeMouseOnCanvas() // hack: immediately update the var
      // Update the actions that depend on mouse movement. (It's important that
      // these updates are invoked BEFORE any begin___() functions. The begin___
      // funcs may induce changes to derived data that the updates need to see.)
      updateDrawAndSlide()
      updateWarp()
      updateEraseSelect()
      updateRigidSelect()
      updateFlexSelect()
      // Check for the initiation of drag-based operations.
      if (toolBeingUsed) {
         let dragVector = mouseOnCanvas
            .displacementFrom(toolBeingUsed.canvasDownPosition)
            .scaledBy(cameraZoom)
         let shortDrag = dragVector.sqLength() >= sqShortDragDelay
         let longDrag = dragVector.sqLength() >= sqLongDragDelay
         let { tool } = toolBeingUsed
         if (tool === "draw" && !draw && longDrag) {
            beginDraw(dragVector)
         } else if (tool === "warp" && !warp && shortDrag) {
            let target = closestGrabbable(toolBeingUsed.canvasDownPosition)
            if (target) beginWarp(movablesOf(target.object), target.closestPart)
         } else if (tool === "slide" && !slide && longDrag) {
            let dragAxis = Axis.fromVector(dragVector)
            let target = closestGrabbable(toolBeingUsed.canvasDownPosition)
            if (dragAxis && target) {
               let slideAxis: Axis
               if (target.object instanceof Segment) {
                  let axes = new Set([
                     ...target.object.start.axes(),
                     ...target.object.end.axes(),
                  ])
                  if (axes.size === 1) axes.add(target.object.axis.orthogonal())
                  slideAxis = nearestAxis(dragAxis, [...axes])
               } else {
                  let axes = target.object.axes()
                  if (axes.length === 0) axes = primaryAxes
                  else if (axes.length === 1) axes.push(axes[0].orthogonal())
                  slideAxis = nearestAxis(dragAxis, axes)
               }
               beginSlide(slideAxis, target.object, target.closestPart)
            }
         } else if (tool === "erase" && !eraseSelect && shortDrag) {
            beginEraseSelect(toolBeingUsed.canvasDownPosition)
         } else if (tool === "rigid" && !rigidSelect && shortDrag) {
            beginRigidSelect(toolBeingUsed.canvasDownPosition)
         } else if (tool === "flex" && !flexSelect && shortDrag) {
            beginFlexSelect(toolBeingUsed.canvasDownPosition)
         }
      }
   }
   // Pre-process the SVG (already in the DOM) of the schematic symbol whose
   // file path is given.
   function registerSymbolKind(fileName: string) {
      let object = document.getElementById(fileName) as HTMLObjectElement
      let svgDocument = object.contentDocument
      if (svgDocument && svgDocument.firstChild?.nodeName === "svg") {
         let svg = svgDocument.firstChild as SVGElement
         // Compute the bounding box of the whole SVG.
         let svgBox
         {
            svg.getBoundingClientRect() // hack to fix Safari's calculations
            let { x, y, width, height } = svg.getBoundingClientRect()
            svgBox = Range2D.fromXY(
               new Range1D([x, x + width]),
               new Range1D([y, y + height])
            )
         }
         // Locate the collision box and ports of the symbol.
         let collisionBox
         let portLocations = []
         for (let element of svg.querySelectorAll("[id]")) {
            if (element.id === "collisionBox") {
               let { x, y, width, height } = element.getBoundingClientRect()
               collisionBox = Range2D.fromXY(
                  new Range1D([x, x + width]),
                  new Range1D([y, y + height])
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
            { fileName, svgTemplate: svg, svgBox, collisionBox, portLocations },
         ].sort((a, b) => (a.fileName < b.fileName ? -1 : 1))
      }
   }
   function spawnSymbol(kind: SymbolKind, grabOffset: Vector) {
      // Spawn a symbol on the canvas, and initiate a move action.
      let spawnPosition = mouseOnCanvas.displacedBy(
         grabOffset.scaledBy(1 / cameraZoom)
      )
      let symbol = new SymbolInstance(kind, spawnPosition, Rotation.zero)
      toolBeingUsed = { tool: "warp", canvasDownPosition: mouseOnCanvas }
      beginWarp(new Set([symbol]), mouseOnCanvas)
   }

   // ---------------------------- Derived events -----------------------------
   function endPan() {
      committedCameraPosition = cameraPosition
      pan = null
   }
   function beginDraw(dragVector: Vector) {
      if (!toolBeingUsed) return
      let drawMode = selectedDrawMode()
      if (toolBeingUsed.chainDrawFromEnd) {
         let end = toolBeingUsed.chainDrawFromEnd
         toolBeingUsed.chainDrawFromEnd = undefined
         // Start the draw operation at the endpoint of the previous
         // draw operation.
         let lastDrawAxis = end.axes()[0]
         // Determine the axis the draw operation should begin along.
         let drawAxis = Axis.fromVector(dragVector) as Axis
         if (drawMode === "strafing") {
            drawAxis = nearestAxis(
               drawAxis,
               primaryAxes.filter((axis) => axis !== lastDrawAxis)
            )
         } else if (drawMode === "snapped rotation") {
            drawAxis = nearestAxis(
               drawAxis,
               snapAxes.filter((axis) => axis !== lastDrawAxis)
            )
         }
         newDraw(end, drawAxis)
         return
      } else if (
         closestAttachableOrToggleable(toolBeingUsed.canvasDownPosition)
            ?.object instanceof Crossing
      ) {
         return // Don't allow draw operations to start at crossings.
      }
      // Otherwise, start the draw operation at the closest attachable.
      let attach = closestAttachable(toolBeingUsed.canvasDownPosition)
      // First, determine the axis the draw operation should begin along.
      let dragAxis = Axis.fromVector(dragVector) as Axis
      let regularDrawAxis, specialDrawAxis
      if (drawMode === "free rotation") {
         regularDrawAxis = specialDrawAxis = dragAxis
      } else {
         let regularAxes = drawMode === "strafing" ? primaryAxes : snapAxes
         let extraAxesToConsider =
            attach?.object instanceof Segment
               ? [attach.object.axis] // The axis of the segment.
               : attach
               ? [...attach.object.axes()] // The axes incident to the vertex.
               : []
         regularDrawAxis = nearestAxis(dragAxis, regularAxes)
         specialDrawAxis = nearestAxis(dragAxis, [
            ...regularAxes,
            ...extraAxesToConsider,
         ])
      }
      if (attach?.object instanceof Segment) {
         let segment = attach.object
         if (specialDrawAxis === segment.axis) {
            // Cut the segment, and allow the user to move one side of it.
            let direction = segment.start.displacementFrom(attach.closestPart)
            let [newStart, other] =
               direction.dot(dragVector) > 0
                  ? [segment.start, segment.end]
                  : [segment.end, segment.start]
            let jMove = new Junction(attach.closestPart)
            let jOther = new Junction(attach.closestPart)
            let moveSegment = new Segment(newStart, jMove, segment.axis)
            let otherSegment = new Segment(other, jOther, segment.axis)
            segment.replaceWith(moveSegment, otherSegment)
            continueDraw(moveSegment, jMove)
         } else {
            // Create a T-junction.
            let junction = new Junction(attach.closestPart)
            segment.splitAt(junction)
            newDraw(junction, regularDrawAxis)
         }
      } else if (attach) {
         let vertex = attach.object
         let continuedDraw = false
         if (
            vertex instanceof Junction &&
            shouldExtendTheSegmentAt(vertex, specialDrawAxis)
         ) {
            // Extend the segment.
            continueDraw([...vertex.edges()][0][0], vertex)
            continuedDraw = true
         } else {
            for (let [segment, other] of vertex.edges()) {
               if (segment.axis !== specialDrawAxis) continue
               if (other.displacementFrom(vertex).dot(dragVector) <= 0) continue
               // Unplug this segment from the vertex.
               let junction = new Junction(vertex)
               let newSegment = new Segment(other, junction, segment.axis)
               segment.replaceWith(newSegment)
               if (vertex instanceof Junction && vertex.edges().size === 2)
                  vertex.convertToCrossing(crossingMap)
               // Allow the user to move the unplugged segment around.
               continueDraw(newSegment, junction)
               continuedDraw = true
               break
            }
         }
         if (!continuedDraw) newDraw(vertex, regularDrawAxis)
      } else
         newDraw(
            new Junction(toolBeingUsed.canvasDownPosition),
            regularDrawAxis
         )
   }
   function newDraw(start: Vertex, axis: Axis) {
      let mode: DrawMode = selectedDrawMode()
      let end = new Junction(start)
      let segment = new Segment(start, end, axis)
      draw = {
         mode,
         segment,
         end,
         segmentIsNew: true,
      }
      if (mode === "strafing") beginDrawStrafing()
   }
   function continueDraw(drawSegment: Segment, end: Junction) {
      let mode: DrawMode = selectedDrawMode()
      let segment
      if (end === drawSegment.end) {
         segment = drawSegment
      } else {
         // Flip the segment around.
         segment = new Segment(drawSegment.end, end, drawSegment.axis)
         drawSegment.replaceWith(segment)
      }
      draw = {
         mode,
         segment,
         end,
         segmentIsNew: false,
      }
      if (mode === "strafing") beginDrawStrafing()
   }
   function beginDrawStrafing() {
      if (!draw) return
      let drawAxis = draw.segment.axis
      let orthoAxis = drawAxis.orthogonal()
      // Pre-compute the information required for snapping.
      if (config.distanceSnap.state === "off") {
         draw.drawAxisRanges = undefined
         draw.orthoRanges = undefined
      } else {
         draw.drawAxisRanges = projectionOfCircuitOnto(
            drawAxis,
            config.distanceSnap.state
         )
         draw.orthoRanges = projectionOfCircuitOnto(
            orthoAxis,
            config.distanceSnap.state
         )
      }
      // Initialize sliding.
      let thingToMove = movableAt(draw.segment.start)
      let axes = thingToMove.axes()
      let slideAxis
      if (axes.length === 1 && axes[0] !== drawAxis) {
         slideAxis = axes[0]
      } else if (axes.length === 2 && axes.includes(drawAxis)) {
         slideAxis = axes[0] === drawAxis ? axes[1] : axes[0]
      } else {
         slideAxis = orthoAxis
      }
      beginSlide(slideAxis, thingToMove, draw.segment.start)
   }
   function endDraw(allowedToDelete: boolean = true) {
      if (!draw) return
      endSlide()
      let segment = draw.segment
      let endObject = draw.endObject
      function isAcceptable() {
         for (let [s, other] of segment.start.edges()) {
            if (
               s !== segment &&
               s.axis === segment.axis &&
               other.distanceFrom(segment.end) + 1 <
                  segment.start.distanceFrom(segment.end) +
                     other.distanceFrom(segment.start)
            )
               return false
         }
         return true
      }
      if (segment.sqLength() >= sqMinSegmentLength && isAcceptable()) {
         if (endObject) {
            if (endObject instanceof Segment) {
               // Turn the intersected Segment into a T-junction.
               endObject.splitAt(draw.end)
            } else {
               let extend =
                  endObject instanceof Junction &&
                  shouldExtendTheSegmentAt(endObject, segment.axis)
               // Replace the drawn segment with one that ends at the Vertex.
               segment.replaceWith(
                  new Segment(segment.start, endObject, segment.axis)
               )
               if (extend)
                  (endObject as Junction).convertToCrossing(crossingMap)
            }
         }
      } else if (allowedToDelete) {
         deleteItems([draw.end])
      }
      draw = null
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function abortDraw() {
      abortSlide()
      if (draw?.segmentIsNew) deleteItems([draw.end])
      draw = null
   }
   function chainDraw(rigidifyCurrent: boolean) {
      if (!draw || !toolBeingUsed) return
      draw.segment.isRigid = rigidifyCurrent
      // Start a new draw operation at the current draw endpoint.
      toolBeingUsed.canvasDownPosition = mouseOnCanvas
      toolBeingUsed.chainDrawFromEnd = draw.end
      draw.endObject = undefined // Don't connect to anything else.
      endDraw(false)
   }
   function beginSlide(slideAxis: Axis, grabbed: Grabbable, atPart: Point) {
      function generateInstructions(
         slideDir: Direction,
         shouldPushNonConnected: boolean
      ): SlideInstruction[] {
         let instructions: SlideInstruction[] = [] // the final sequence
         let orthogonalAxis = slideAxis.orthogonal()
         let slideRanges = projectionOfCircuitOnto(slideDir)
         let orthoRanges = projectionOfCircuitOnto(orthogonalAxis, slidePad / 2)
         if (draw) {
            // The segment being drawn should be invisible to the slide op.
            slideRanges.delete(draw.end)
            orthoRanges.delete(draw.end)
            slideRanges.delete(draw.segment)
            orthoRanges.delete(draw.segment)
         }

         // ------------------ PART 1: Initialize the heap. -------------------
         // Instructions need to be scheduled in order of priority. Thus, as
         // instructions are proposed, we insert them into a heap.
         let heap = new Heap<SlideInstruction>((a, b) => a.delay - b.delay)
         // Proposals are also stored in a Map, so that we can update them.
         let proposals = new Map<Movable, SlideInstruction>()
         // Add the initial proposals to the heap.
         if (grabbed instanceof Segment) {
            let startMovable = movableAt(grabbed.start)
            let endMovable = movableAt(grabbed.end)
            let i1 = { movable: startMovable, delay: 0, isPush: false }
            let i2 = { movable: endMovable, delay: 0, isPush: false }
            heap.push(i1)
            heap.push(i2)
            proposals.set(startMovable, i1)
            proposals.set(endMovable, i2)
         } else {
            let i = { movable: grabbed, delay: 0, isPush: false }
            heap.push(i)
            proposals.set(grabbed, i)
         }

         // --------------- PART 2: Generate the instructions. ----------------
         while (heap.size() > 0) {
            let nextInstruction = heap.pop() as SlideInstruction
            let { movable, delay, isPush } = nextInstruction
            instructions.push(nextInstruction) // Finalize this instruction.

            function pushNonConnected(pusher: Pushable) {
               if (config.distanceSnap.state === "off") return
               if (!slideRanges.has(pusher)) return
               let pusherSlide = slideRanges.get(pusher) as Range1D
               let pusherOrthogonal = orthoRanges.get(pusher) as Range1D
               for (let [target, targetOrthogonal] of orthoRanges) {
                  if (
                     pusher instanceof Junction &&
                     target instanceof Junction &&
                     [...target.edges()].every(([s]) => s.axis !== slideAxis)
                  )
                     continue // This interaction doesn't make much sense.
                  if (target instanceof Segment && target.axis === slideAxis) {
                     // To allow a segment parallel to the slideAxis to be
                     // squished, we should push the endpoints, not the segment.
                     continue
                  }
                  if (!pusherOrthogonal.intersects(targetOrthogonal)) continue
                  let targetSlide = slideRanges.get(target) as Range1D
                  let disp = targetSlide.displacementFrom(pusherSlide)
                  if (disp <= 0) continue
                  let distance = Math.max(0, disp - config.distanceSnap.state)
                  if (target instanceof Segment) {
                     proposeTo(movableAt(target.start), delay + distance, true)
                     proposeTo(movableAt(target.end), delay + distance, true)
                  } else {
                     proposeTo(target, delay + distance, true)
                  }
               }
            }
            if (shouldPushNonConnected) {
               pushNonConnected(movable) // Movable pushes things in its path.
            }
            // Propagate the movement along the Movable's edges.
            for (let [segment, adjVertex] of movable.edges()) {
               if (segment === draw?.segment) continue // handled elsewhere
               if (segment.axis === orthogonalAxis && shouldPushNonConnected) {
                  pushNonConnected(segment) // Orthogonal segments push things!
               }
               // ---------- Logic for pushing connected Movables. ------------
               let nearVertex =
                  adjVertex === segment.end ? segment.start : segment.end
               let adjDir = adjVertex.directionFrom(nearVertex)
               if (!adjDir) continue
               let canStretch = segment.axis === slideAxis && !segment.isRigid
               if (
                  canStretch &&
                  adjDir.approxEquals(slideDir, 0.1) &&
                  config.distanceSnap.state !== "off"
               ) {
                  // Allow the edge to contract to the standard length.
                  let contraction = Math.max(
                     0,
                     segment.length() - config.distanceSnap.state
                  )
                  proposeTo(movableAt(adjVertex), delay + contraction, true)
               } else if (canStretch) {
                  // The segment can stretch indefinitely.
                  continue
               } else {
                  proposeTo(movableAt(adjVertex), delay, isPush)
               }
            }
         }
         function proposeTo(movable: Movable, delay: number, isPush: boolean) {
            let existingProposal = proposals.get(movable)
            if (existingProposal) {
               if (existingProposal.delay > delay) {
                  // We've found something that will push the
                  // Movable *sooner*. Decrease its delay.
                  existingProposal.delay = delay
                  heap.updateItem(existingProposal)
               }
            } else {
               // Add an initial proposal to the heap.
               let proposal = { movable: movable, delay, isPush }
               heap.push(proposal)
               proposals.set(movable, proposal)
            }
         }
         return instructions
      }
      let posInstructions, negInstructions
      if (selectedSlideMode() === "push connected") {
         posInstructions = generateInstructions(slideAxis.posDirection(), false)
         negInstructions = generateInstructions(slideAxis.negDirection(), false)
      } else {
         posInstructions = generateInstructions(slideAxis.posDirection(), true)
         negInstructions = generateInstructions(slideAxis.negDirection(), true)
      }
      let contactPositions = posInstructions
         .flatMap((i) => (i.isPush ? [i.delay] : []))
         .concat(negInstructions.flatMap((i) => (i.isPush ? [-i.delay] : [])))
      slide = {
         mode: selectedSlideMode(),
         originalPositions: copyPositions(),
         grabbed,
         start: atPart.clone(),
         axis: slideAxis,
         posInstructions,
         negInstructions,
         contactPositions,
      }
   }
   function endSlide() {
      slide = null
   }
   function abortSlide() {
      if (!slide) return
      // TODO: This approach doesn't work if Shift is pressed during the
      // movement, since this resets slide.originalPositions. The "right" way
      // to cancel the slide will be to invoke the UNDO operation, once it is
      // implemented.

      // Move all the circuit elements back to their original positions.
      for (let m of allMovables()) m.moveTo(slide.originalPositions.read(m))
      slide = null
   }
   function updateDrawAndSlide() {
      if (draw && draw.mode !== selectedDrawMode()) {
         // Change the draw mode.
         endSlide() // If we were sliding, commit the operation.
         draw.mode = selectedDrawMode()
         if (draw.mode === "strafing") beginDrawStrafing()
      } else if (slide) {
         if (slide.mode !== selectedSlideMode()) {
            let { axis, grabbed } = slide
            endSlide()
            beginSlide(axis, grabbed, mouseOnCanvas)
         } else {
            // Revert the slide operation; it will be redone from scratch.
            for (let m of allMovables())
               m.moveTo(slide.originalPositions.read(m))
         }
      }
      //--- PART 1: Do draw operations that can/must be done before sliding. ---
      let snappedToVertex = false
      let targetSegments = draw
         ? [...Segment.s].filter(
              (seg) =>
                 ![...draw!.segment.start.edges()].find(([s]) => s === seg)
           )
         : []
      // This function checks whether draw.segment can be displaced toward the
      // given Movable by the given "extra" displacement (i.e. beyond the mouse
      // position), without causing the Movable itself to be moved.
      function canDisplaceTowardMovable(movable: Movable, disp: number) {
         if (!draw || !slide) return true
         // The following expression computes the slide that needs to be
         // performed to move draw.start into alignment with draw.end.
         let slideDistance = mouseOnCanvas
            .displacedBy(draw.segment.axis.orthogonal().scaledBy(disp))
            .displacementFrom(draw.segment.start)
            .inTermsOfBasis([slide.axis, draw.segment.axis])[0]
            .scalarProjectionOnto(slide.axis)
         let instructions =
            slideDistance > 0 ? slide.posInstructions : slide.negInstructions
         slideDistance = Math.abs(slideDistance)
         return !instructions.find(
            (i) => movable === i.movable && slideDistance >= i.delay + 0.001
         )
      }
      if (draw) {
         let associatedDrawAxis: (vertex: Vertex) => Axis
         let defaultDrawEnd: Point
         let defaultDrawAxis: Axis
         if (draw.mode === "strafing") {
            associatedDrawAxis = () => draw!.segment.axis
            defaultDrawEnd = mouseOnCanvas
            defaultDrawAxis = draw.segment.axis
         } else {
            associatedDrawAxis = (vertex: Vertex) =>
               Axis.fromVector(vertex.displacementFrom(draw!.segment.start)) ||
               draw!.segment.axis
            // By default, draw to the mouse position.
            defaultDrawEnd = mouseOnCanvas
            defaultDrawAxis =
               Axis.fromVector(
                  mouseOnCanvas.displacementFrom(draw.segment.start)
               ) || draw.segment.axis
            // But if possible, snap to a nice axis.
            if (draw.mode === "snapped rotation") {
               let adjacentAxes = [...movableAt(draw.segment.start).edges()]
                  .filter(([seg]) => seg !== draw!.segment)
                  .map(([seg]) => seg.axis)
               let niceAxes = new Set([...snapAxes, ...adjacentAxes])
               let closestAxis: Axis | undefined
               let sqDistance: number = Infinity
               for (let axis of niceAxes) {
                  let sqRejection = new Line(draw.segment.start, axis)
                     .partClosestTo(mouseOnCanvas)
                     .sqDistanceFrom(mouseOnCanvas)
                  if (sqRejection < sqDistance) {
                     closestAxis = axis
                     sqDistance = sqRejection
                  }
               }
               if (closestAxis) {
                  let closestPart = new Line(
                     draw.segment.start,
                     closestAxis
                  ).partClosestTo(mouseOnCanvas)
                  if (sqDistance < sqSnapRadius) {
                     defaultDrawEnd = closestPart
                     defaultDrawAxis = closestAxis
                  } else if (sqDistance < sqEaseRadius) {
                     let d = closestPart.directionFrom(
                        mouseOnCanvas
                     ) as Direction
                     defaultDrawEnd = mouseOnCanvas.displacedBy(
                        d.scaledBy(easeFn(Math.sqrt(sqDistance)))
                     )
                     defaultDrawAxis =
                        Axis.fromVector(
                           defaultDrawEnd.displacementFrom(draw.segment.start)
                        ) || draw.segment.axis
                  }
               }
            }
         }
         function isAcceptable(v: Vertex) {
            if (v === draw!.segment.start || v === draw!.end) return false
            let drawAxis = associatedDrawAxis(v)
            let drawDir = v
               .displacementFrom(draw!.segment.start)
               .projectionOnto(drawAxis)
               .direction()
            if (!drawDir) return false
            for (let [{ axis }, other] of v.edges()) {
               // Reject if the segment being drawn would overlap this segment.
               if (axis !== drawAxis) continue
               let dir = v.directionFrom(other)
               if (dir?.approxEquals(drawDir, 0.1)) return false
            }
            if (slide) {
               // Reject if snapping to the vertex is impossible, because the
               // vertex would slide away from the mouse.
               let orthoDisp = v
                  .displacementFrom(mouseOnCanvas)
                  .scalarProjectionOnto(drawAxis.orthogonal())
               if (!canDisplaceTowardMovable(movableAt(v), orthoDisp))
                  return false
            }
            return true
         }
         let acceptableVertices = Array.from(allVertices()).filter(isAcceptable)
         let closestVertex = closestNearTo(mouseOnCanvas, acceptableVertices)
         if (closestVertex) {
            // Snap to the closest vertex.
            draw.end.moveTo(closestVertex.object)
            draw.segment.updateAxis(associatedDrawAxis(closestVertex.object))
            draw.endObject = closestVertex.object
            snappedToVertex = true
         } else {
            draw.end.moveTo(defaultDrawEnd)
            draw.segment.updateAxis(defaultDrawAxis)
         }
      }
      if (
         draw?.mode === "strafing" &&
         !snappedToVertex &&
         draw.drawAxisRanges &&
         draw.orthoRanges &&
         slide
      ) {
         // Try snapping by strafing towards nearby things.
         let drawAxis = draw.segment.axis
         let orthoAxis = drawAxis.orthogonal()
         let vs = draw.segment.start.displacementFrom(Point.zero)
         let ve = draw.segment.end.displacementFrom(Point.zero)
         let drawRange = new Range1D([
            vs.scalarProjectionOnto(drawAxis),
            ve.scalarProjectionOnto(drawAxis),
         ])
         let orthoRange = new Range1D([ve.scalarProjectionOnto(orthoAxis)])
         // For each axis, find the circuit element closest to draw.segment
         // for which snapping is possible. (Snapping interacts with sliding;
         // we must ignore snapping to things that will ultimately slide.)
         let minDisp = Infinity
         for (let [target, targetDraw] of draw.drawAxisRanges) {
            if (target === draw.segment) continue
            if (target === draw.end) continue
            if (drawRange.intersects(targetDraw)) {
               let targetOrtho = draw.orthoRanges.get(target) as Range1D
               let d = targetOrtho.displacementFromContact(orthoRange)
               let movs = isMovable(target)
                  ? [target]
                  : [movableAt(target.start), movableAt(target.end)]
               if (
                  Math.abs(d) < Math.abs(minDisp) &&
                  movs.every((mov) => canDisplaceTowardMovable(mov, d))
               )
                  minDisp = d
            }
         }
         // Also consider the snap positions of the slide operation.
         let slideDisp = draw.end
            .displacementFrom(draw.segment.start)
            .inTermsOfBasis([slide.axis, draw.segment.axis])[0]
            .scalarProjectionOnto(slide.axis)
         for (let position of slide.contactPositions) {
            let d = slide.axis
               .scaledBy(position - slideDisp)
               .scalarProjectionOnto(orthoAxis)
            if (Math.abs(d) < Math.abs(minDisp)) minDisp = d
         }
         // Perform the snap.
         if (Math.abs(minDisp) >= easeRadius) {
            minDisp = 0
         } else if (Math.abs(minDisp) >= snapRadius) {
            minDisp = Math.sign(minDisp) * easeFn(Math.abs(minDisp))
         }
         draw.end.moveBy(orthoAxis.scaledBy(minDisp))
      }
      // --------------------- PART 2: Perform the slide. ---------------------
      if (slide) {
         // Determine the direction and distance things should move.
         let slideDistance: number
         if (draw) {
            // The required slideDistance has already been determined in PART 1:
            // it is the distance that draw.start needs to move along slide.axis
            // to ensure the orientation of draw.segment remained unchanged.
            let [slideVector] = draw.end
               .displacementFrom(draw.segment.start)
               .inTermsOfBasis([slide.axis, draw.segment.axis])
            slideDistance = slideVector.scalarProjectionOnto(slide.axis)
         } else {
            // The slideDistance is determined by the position of the mouse.
            slideDistance = mouseOnCanvas
               .displacementFrom(slide.start)
               .scalarProjectionOnto(slide.axis)
            // If the current slideDistance is _close_ to the distance at which
            // two objects touch, ease toward that distance.
            let smallestDistance = Infinity
            for (let position of slide.contactPositions) {
               let distance = slideDistance - position
               if (Math.abs(distance) < Math.abs(smallestDistance))
                  smallestDistance = distance
            }
            if (Math.abs(smallestDistance) < snapRadius) {
               slideDistance -= smallestDistance
            } else if (Math.abs(smallestDistance) < easeRadius) {
               slideDistance -=
                  Math.sign(smallestDistance) *
                  easeFn(Math.abs(smallestDistance))
            }
         }
         let direction, instructions
         if (slideDistance > 0) {
            direction = slide.axis.posDirection()
            instructions = slide.posInstructions
         } else {
            direction = slide.axis.negDirection()
            instructions = slide.negInstructions
            slideDistance = -slideDistance
         }
         // Perform the new movement.
         for (let instruction of instructions) {
            let distance = slideDistance - instruction.delay
            if (distance <= 0) break
            instruction.movable.moveBy(direction.scaledBy(distance))
         }
      }
      // ----------------- PART 3: Snap along the draw axis. ------------------
      // Now that sliding has been performed (if applicable), snap the *length*
      // of draw.segment toward things of interest.
      if (draw && !snappedToVertex) {
         draw.endObject = undefined
         let drawAxis = draw.segment.axis
         let orthoAxis = drawAxis.orthogonal()
         let closest = closestSegmentNearTo(draw.end, drawAxis, targetSegments)
         if (closest) {
            // Snap to the nearby segment.
            draw.end.moveTo(closest.closestPart)
            draw.endObject = closest.object
         } else if (config.distanceSnap.state !== "off") {
            // Try snapping draw.end to a standard distance from a nearby
            // circuit element.
            // The circuit needs to be re-projected (every frame!) so that we
            // can figure out what circuit elements are "in front of" draw.end.
            let halfDist = config.distanceSnap.state / 2
            let drawAxisRanges = projectionOfCircuitOnto(drawAxis, halfDist)
            let orthoRanges = projectionOfCircuitOnto(orthoAxis, halfDist)
            let drawEndRange = drawAxisRanges.get(draw.end) as Range1D
            let orthoRange = orthoRanges.get(draw.end) as Range1D
            // Find the closest thing that draw.end can snap toward.
            let minDisp = Infinity
            for (let [target, targetOrtho] of orthoRanges) {
               if (target === draw.segment) continue
               if (target === draw.end) continue
               if (target instanceof Junction) continue
               if (orthoRange.intersects(targetOrtho)) {
                  let targetDraw = drawAxisRanges.get(target) as Range1D
                  let d = targetDraw.displacementFromContact(drawEndRange)
                  if (Math.abs(d) < Math.abs(minDisp)) minDisp = d
               }
            }
            // Perform the snap.
            if (Math.abs(minDisp) >= easeRadius) {
               minDisp = 0
            } else if (Math.abs(minDisp) >= snapRadius) {
               minDisp = Math.sign(minDisp) * easeFn(Math.abs(minDisp))
            }
            draw.end.moveBy(drawAxis.scaledBy(minDisp))
         }
      }
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function beginWarp(movables: Set<Movable>, partGrabbed: Point) {
      // Compute the point about which rotation should occur.
      let d = zeroVector
      for (let m of movables) {
         let p = m instanceof SymbolInstance ? m.center() : m
         d = d.add(p.displacementFrom(Point.zero))
      }
      let centroid = Point.zero.displacedBy(d.scaledBy(1 / movables.size))
      // Determine which rotations will align the axes of the selected items
      // with the snapAxes.
      let selectedAxes = new Set<Axis>()
      for (let movable of movables) {
         // Consider the axes of segments that lie between selected items.
         for (let [segment, farVertex] of movable.edges()) {
            if (movables.has(movableAt(farVertex)))
               selectedAxes.add(segment.axis)
         }
         // Consider the intrinsic axis of Symbols.
         if (movable instanceof SymbolInstance)
            selectedAxes.add(Axis.fromDirection(movable.direction))
      }
      let keyRotations = new Set<Rotation>()
      for (let axis of selectedAxes) {
         for (let snap of snapAxes) {
            let dir = snap.posDirection()
            keyRotations.add(dir.rotationFrom(axis.posDirection()))
            keyRotations.add(dir.rotationFrom(axis.negDirection()))
         }
      }
      // Gather the incident edges; these are the edges that will be "warped".
      let incidentEdges = new Set(
         [...movables].flatMap((movable) =>
            [...movable.edges()].filter(([_, v]) => !movables.has(movableAt(v)))
         )
      )
      warp = {
         mode: selectedWarpMode(),
         movables,
         centroid,
         keyRotations,
         incidentEdges,
         originalPositions: copyPositions(),
         originalDirections: copySymbolDirections(),
         start: partGrabbed,
      }
   }
   function updateWarp() {
      if (!warp) return
      if (warp.mode !== selectedWarpMode()) {
         let { movables } = warp
         endWarp()
         beginWarp(movables, mouseOnCanvas)
      } else {
         // Revert the operation; it will be redone from scratch.
         for (let m of warp.movables) {
            m.moveTo(warp.originalPositions.read(m))
            if (m instanceof SymbolInstance) {
               ;(m.direction as Direction) = warp.originalDirections.read(m)
            }
         }
      }
      if (warp.mode === "pan") {
         updatePan()
      } else {
         updateRotate()
      }
   }
   function updatePan() {
      if (!warp) return
      // Start by moving everything as if it was following the mouse.
      let d = mouseOnCanvas.displacementFrom(warp.start)
      for (let movable of warp.movables) movable.moveBy(d)

      if (config.angleSnap.state === "on") {
         // Gather the axes of interest.
         let neighbourAxes = new Set(
            [...warp.incidentEdges].flatMap(([s, neighbour]) =>
               [...neighbour.edges()]
                  .filter(([_, v]) => !warp!.movables.has(movableAt(v)))
                  .map(([segment]) => segment.axis)
            )
         )
         // We aim to displace ("snap") the Movables slightly such that their
         // incident edges will have a "nice" axis.
         let niceAxes = [...snapAxes, ...neighbourAxes]

         // Begin by computing the minimum rejection from each axis.
         let axisRejections = new DefaultMap<Axis, Vector>(() => infinityVector)
         for (let [segment, farVertex] of warp.incidentEdges) {
            let nearVertex =
               farVertex === segment.end ? segment.start : segment.end
            for (let axis of niceAxes) {
               let rejection = new Line(farVertex, axis)
                  .partClosestTo(nearVertex)
                  .displacementFrom(nearVertex)
               if (rejection.sqLength() < axisRejections.read(axis).sqLength())
                  axisRejections.set(axis, rejection)
            }
         }
         // Sort the rejections so that the two smallest ones can be used.
         let rejections = [...axisRejections].sort(
            (x, y) => x[1].sqLength() - y[1].sqLength()
         )
         let oneAxisDisplacement = infinityVector
         if (rejections.length >= 1) {
            oneAxisDisplacement = rejections[0][1]
         }
         let twoAxisDisplacement = infinityVector
         if (rejections.length >= 2) {
            // Find the displacement vector that satisfies both of the
            // rejections simultaneously. (Take the intersection of the dual
            // lines associated with each displacement vector.)
            let [[axis1, reject1], [axis2, reject2]] = rejections
            let dualLine1 = new Line(Point.zero.displacedBy(reject1), axis1)
            let dualLine2 = new Line(Point.zero.displacedBy(reject2), axis2)
            let intersection = dualLine1.intersection(dualLine2)
            if (intersection) {
               twoAxisDisplacement = intersection.displacementFrom(Point.zero)
            }
         }
         let displacement = zeroVector
         // First, ease to the nearest axis. This keeps the movement "on a rail".
         let sqLength1 = oneAxisDisplacement.sqLength()
         if (sqLength1 < sqSnapRadius) {
            displacement = oneAxisDisplacement
         } else if (sqLength1 < sqEaseRadius) {
            displacement = oneAxisDisplacement
               .direction()
               ?.scaledBy(easeFn(Math.sqrt(sqLength1))) as Vector
         }
         // Next, ease to the intersection.
         let remainingDisplacement = twoAxisDisplacement.sub(displacement)
         let sqLength2 = remainingDisplacement.sqLength()
         if (sqLength2 < sqSnapRadius) {
            displacement = twoAxisDisplacement
         } else if (sqLength2 < sqEaseRadius) {
            displacement = displacement.add(
               remainingDisplacement
                  .direction()
                  ?.scaledBy(easeFn(Math.sqrt(sqLength2))) as Vector
            )
         }
         // Execute the movement.
         for (let movable of warp.movables) movable.moveBy(displacement)
      }

      // Finally, update the axis object associated with each incident edge.
      for (let [segment] of warp.incidentEdges) {
         let axis = Axis.fromVector(segment.end.displacementFrom(segment.start))
         if (!axis) continue
         segment.updateAxis(axis)
      }
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function updateRotate() {
      if (!warp) return
      // First, find the magnitude of the rotation to be performed.
      let startDir = warp.start.directionFrom(warp.centroid)
      let mouseDir = mouseOnCanvas.directionFrom(warp.centroid)
      if (!startDir || !mouseDir) return
      let mouseRotation = mouseDir.rotationFrom(startDir)

      // Then, if the rotation is close to a keyRotation, ease to it.
      let easedRotation = mouseRotation
      if (config.angleSnap.state === "on") {
         let closest: Rotation = Rotation.fromDegrees(180)
         for (let key of warp.keyRotations) {
            let r = key.sub(mouseRotation)
            if (Math.abs(r.toRadians()) < Math.abs(closest.toRadians()))
               closest = r
         }
         let radius = mouseOnCanvas.distanceFrom(warp.centroid)
         let arcLength = radius * Math.abs(closest.toRadians())
         if (arcLength < snapRadius) {
            easedRotation = mouseRotation.add(closest)
         } else if (arcLength < easeRadius) {
            let scale = easeFn(arcLength) / arcLength
            easedRotation = mouseRotation.add(closest.scaledBy(scale))
         }
      }
      // Then, apply the rotation.
      for (let m of warp.movables) m.rotateAround(warp.centroid, easedRotation)

      // Finally, update the axis object associated with each incident edge.
      for (let [segment] of warp.incidentEdges) {
         let axis = Axis.fromVector(segment.end.displacementFrom(segment.start))
         if (!axis) continue
         segment.updateAxis(axis)
      }

      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function endWarp() {
      warp = null
   }
   function abortWarp() {
      endWarp() // TODO: The right way to abort is to "undo" the operation.
   }
   function beginEraseSelect(start: Point) {
      eraseSelect = { start, items: new Set() }
   }
   function beginRigidSelect(start: Point) {
      rigidSelect = { start, items: new Set() }
   }
   function beginFlexSelect(start: Point) {
      flexSelect = { start, items: new Set() }
   }
   function updateEraseSelect() {
      if (!eraseSelect) return
      eraseSelect.items = new Set()
      let range = Range2D.fromCorners(eraseSelect.start, mouseOnCanvas)
      for (let segment of Segment.s)
         if (range.intersects(segment)) eraseSelect.items.add(segment)
      for (let symbol of SymbolInstance.s)
         if (range.intersects(symbol)) eraseSelect.items.add(symbol)
   }
   function updateRigidSelect() {
      if (!rigidSelect) return
      rigidSelect.items = new Set()
      let range = Range2D.fromCorners(rigidSelect.start, mouseOnCanvas)
      for (let segment of Segment.s)
         if (range.intersects(segment)) rigidSelect.items.add(segment)
   }
   function updateFlexSelect() {
      if (!flexSelect) return
      flexSelect.items = new Set()
      let range = Range2D.fromCorners(flexSelect.start, mouseOnCanvas)
      for (let segment of Segment.s)
         if (range.intersects(segment)) flexSelect.items.add(segment)
   }
   function endEraseSelect() {
      if (!eraseSelect) return
      deleteItems(eraseSelect.items)
      eraseSelect = null
   }
   function endRigidSelect() {
      if (!rigidSelect) return
      for (let item of rigidSelect.items) item.isRigid = true
      Segment.s = Segment.s
      rigidSelect = null
   }
   function endFlexSelect() {
      if (!flexSelect) return
      for (let item of flexSelect.items) item.isRigid = false
      Segment.s = Segment.s
      flexSelect = null
   }
   function abortEraseSelect() {
      eraseSelect = null
   }
   function abortRigidSelect() {
      rigidSelect = null
   }
   function abortFlexSelect() {
      flexSelect = null
   }
   function abortAllButtons() {
      for (let key of keyInfo.keys()) keyAborted(key)
   }
   function deleteItems(items: Iterable<Grabbable>) {
      let junctionsToConvert = new Set<Junction>()
      for (let thing of items) {
         if (thing instanceof Port) continue // Ports are not deletable.
         thing.delete().forEach((neighbor) => junctionsToConvert.add(neighbor))
      }
      for (let junction of junctionsToConvert) {
         if (junction.edges().size === 2)
            junction.convertToCrossing(crossingMap)
      }
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }

   // --------------------- Development-time behaviours -----------------------
   onMount(() => {
      // After a hot reload, the SVGs of symbols must re-inserted into the DOM.
      for (let symbol of SymbolInstance.s) symbol.refresh()
   })
</script>

<!----------------------------- Keyboard events ------------------------------>
<svelte:window
   on:mousemove={updateModifierKeys}
   on:keydown={(event) => {
      updateModifierKeys(event)
      if (event.repeat) return // Ignore repeated events from held-down keys.
      keyPressed(event.code)
   }}
   on:keyup={(event) => {
      updateModifierKeys(event)
      keyReleased(event.code)
   }}
   on:blur={() => {
      abortAllButtons()
   }}
/>

<div
   id="app"
   on:contextmenu={(event) => {
      // Disable the context menu.
      event.preventDefault()
      return false
   }}
   on:mousemove|capture={(event) => {
      mouseInClient = new Point(event.clientX, event.clientY)
      if (!leftMouseIsDown(event) && keyInfo.read(LMB).pressing) {
         if (waitedOneFrameLMB) {
            keyAborted(LMB)
         } else {
            waitedOneFrameLMB = true
         }
      } else {
         waitedOneFrameLMB = false
      }
      if (!rightMouseIsDown(event) && keyInfo.read(RMB).pressing) {
         if (waitedOneFrameRMB) {
            keyAborted(RMB)
         } else {
            waitedOneFrameRMB = true
         }
      } else {
         waitedOneFrameRMB = false
      }
      mouseMoved()
   }}
   on:mousedown|capture={(event) => {
      mouseInClient = new Point(event.clientX, event.clientY)
   }}
   on:mouseup|capture={(event) => {
      mouseInClient = new Point(event.clientX, event.clientY)
      if (!leftMouseIsDown(event)) keyReleased(LMB)
      if (!rightMouseIsDown(event)) keyReleased(RMB)
   }}
   on:wheel|capture|nonpassive={(event) => {
      // Turn off the browser's built-in pinch-zoom behaviour.
      if (event.ctrlKey) event.preventDefault()
      // Prevent left and right swipes from triggering page forward/back.
      if (event.deltaX !== 0) event.preventDefault()
   }}
>
   <svg
      bind:this={canvas}
      style="cursor: {cursor}"
      on:mousedown={(event) => {
         event.preventDefault() // Disable selection of nearby text elements.
         if (leftMouseIsDown(event)) keyPressed(LMB)
         if (rightMouseIsDown(event)) keyPressed(RMB)
      }}
      on:wheel={(event) => {
         event.preventDefault()
         if (isMouseWheel(event)) {
            executeZoom(mouseWheelIncrements(event) * wheelZoomSpeed)
            if (cameraZoom > 0.99 && cameraZoom < 1.01) cameraZoom = 1
         } else {
            if (event.ctrlKey) {
               // Pinch zoom emits a fake "ctrl" modifier.
               executeZoom(-event.deltaY * pinchZoomSpeed)
            } else {
               let movement = new Vector(event.deltaX, event.deltaY).scaledBy(
                  panSpeed / cameraZoom
               )
               committedCameraPosition =
                  committedCameraPosition.displacedBy(movement)
               // Moving the camera moves the position of the mouse on the
               // canvas, so we need to trigger the corresponding event.
               mouseMoved()
            }
         }
      }}
   >
      <!--- Camera transform --->
      <g
         transform="scale({cameraZoom}) translate({svgTranslate.x} {svgTranslate.y})"
      >
         <!-- Symbol highlight layer -->
         <g>
            {#each [...SymbolInstance.s] as symbol}
               {@const c = symbol.svgCorners()}
               {#if styleOf(symbol)}
                  <polygon
                     style="stroke-width: 8px"
                     class="symbolHighlight fill stroke {styleOf(symbol)}"
                     points="{c[0].x},{c[0].y} {c[1].x},{c[1].y} {c[2].x},{c[2]
                        .y} {c[3].x},{c[3].y}"
                  />
               {/if}
            {/each}
         </g>
         <!-- Segment highlight layer 1 -->
         <g>
            {#each [...segmentsToDraw] as [segment, sections]}
               {#if hoverLight.has(segment)}
                  {#each sections as section}
                     <FluidLine renderStyle="hover" segment={section} />
                  {/each}
               {/if}
            {/each}
         </g>
         <!-- Segment highlight layer 2 -->
         <g>
            {#each [...segmentsToDraw] as [segment, sections]}
               {#if grabLight.has(segment)}
                  {#each sections as section}
                     <FluidLine renderStyle="grab" segment={section} />
                  {/each}
               {/if}
            {/each}
         </g>
         <!-- Segment layer -->
         <g>
            {#each [...segmentsToDraw] as [segment, sections]}
               {#each sections as section}
                  {#if !eraseSelect?.items.has(segment)}
                     <FluidLine
                        segment={section}
                        isRigid={Boolean(
                           (segment.isRigid &&
                              !flexSelect?.items.has(segment)) ||
                              rigidSelect?.items.has(segment)
                        )}
                     />
                  {/if}
               {/each}
            {/each}
         </g>
         <!-- Lower glyph highlight layer -->
         <g>
            {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
               {#if glyph.type === "point marker" && layerOf(glyph.point) === "lower"}
                  <PointMarker
                     renderStyle={glyph.style}
                     position={glyph.point}
                  />
               {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "lower"}
                  <Plug renderStyle={glyph.style} position={glyph.vertex} />
               {:else if glyph.type === "junction node"}
                  <JunctionNode
                     renderStyle={glyph.style}
                     position={glyph.junction}
                  />
               {:else if glyph.type === "hopover"}
                  <Hopover
                     renderStyle={glyph.style}
                     start={glyph.start}
                     end={glyph.end}
                     flip={glyph.flip}
                  />
               {/if}
            {/each}
         </g>
         <!-- Lower glyph layer -->
         <g>
            {#each [...glyphsToDraw] as glyph}
               {#if glyph.type === "point marker" && layerOf(glyph.point) === "lower"}
                  <PointMarker position={glyph.point} />
               {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "lower"}
                  <Plug position={glyph.vertex} />
               {:else if glyph.type === "junction node"}
                  <JunctionNode position={glyph.junction} />
               {:else if glyph.type === "hopover"}
                  <Hopover
                     start={glyph.start}
                     end={glyph.end}
                     flip={glyph.flip}
                     isRigid={Boolean(
                        (glyph.segment.isRigid &&
                           !flexSelect?.items.has(glyph.segment)) ||
                           rigidSelect?.items.has(glyph.segment)
                     )}
                  />
               {/if}
            {/each}
         </g>
         <!-- Symbol layer -->
         <g id="symbol layer" />
         <!-- Upper glyph highlight layer -->
         <g>
            {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
               {#if glyph.type === "point marker" && layerOf(glyph.point) === "upper"}
                  <PointMarker
                     renderStyle={glyph.style}
                     position={glyph.point}
                  />
               {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "upper"}
                  <Plug renderStyle={glyph.style} position={glyph.vertex} />
               {/if}
            {/each}
         </g>
         <!-- Upper glyph layer -->
         <g>
            {#each [...glyphsToDraw] as glyph}
               {#if glyph.type === "point marker" && layerOf(glyph.point) === "upper"}
                  <PointMarker position={glyph.point} />
               {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "upper"}
                  <Plug position={glyph.vertex} />
               {/if}
            {/each}
         </g>
         <!-- HUD layer -->
         <g>
            {#if config.showSymbolSnaps.state === "on"}
               {#each [...SymbolInstance.s] as symbol}
                  {@const c = symbol.corners()}
                  <polygon
                     style="fill: none; stroke: red; stroke-width: {2 /
                        cameraZoom}px"
                     points="{c[0].x},{c[0].y} {c[1].x},{c[1].y} {c[2].x},{c[2]
                        .y} {c[3].x},{c[3].y}"
                  />
                  {#each symbol.ports as port}
                     <circle
                        style="fill: none; stroke: red; stroke-width: {2 /
                           cameraZoom}px"
                        cx={port.x}
                        cy={port.y}
                        r={6 / cameraZoom}
                     />
                  {/each}
               {/each}
            {/if}
         </g>
         <g>
            <!-- Selection boxes -->
            <!-- {#if multiSelect} <RectSelectBox start={multiSelect.start} end={mouseOnCanvas} />{/if} -->
            {#if eraseSelect}
               <RectSelectBox
                  start={eraseSelect.start}
                  end={mouseOnCanvas}
                  scale={cameraZoom}
               />
            {/if}
            {#if rigidSelect}
               <RectSelectBox
                  start={rigidSelect.start}
                  end={mouseOnCanvas}
                  scale={cameraZoom}
               />
            {/if}
            {#if flexSelect}
               <RectSelectBox
                  start={flexSelect.start}
                  end={mouseOnCanvas}
                  scale={cameraZoom}
               />
            {/if}
         </g>
      </g>
   </svg>

   <div class="sidebar">
      <div class="projectPane">
         <button
            on:click={async () => {
               if (!usingElectron) return
               let response = await fileSystem.openDirectory()
               if (response) {
                  projectFolder = response
                  let newFiles = await fileSystem.getFileNames(
                     path.join(projectFolder, "symbols")
                  )
                  if (newFiles) {
                     symbolFiles = newFiles.filter(
                        (s) => path.extname(s) === ".svg"
                     )
                  } else {
                     symbolFiles = null
                  }
                  symbolKinds = []
               }
            }}>Choose a project folder</button
         >
         {#if projectFolder}
            <div><b>Project name:</b> {path.basename(projectFolder)}</div>
         {:else}
            <div>No folder chosen.</div>
         {/if}
      </div>
      <div
         class="symbolPane"
         on:mouseup={() => {
            grabbedSymbol = null
         }}
         on:mouseleave={() => {
            if (grabbedSymbol) {
               spawnSymbol(grabbedSymbol.kind, grabbedSymbol.grabOffset)
               keyInfo.getOrCreate(LMB).pressing = true
               grabbedSymbol = null
            }
         }}
      >
         {#if (projectFolder && symbolFiles) || !usingElectron}
            <div class="symbolGrid">
               {#each symbolKinds as kind}
                  <div
                     class="symbolGridItem"
                     on:mousedown={() => {
                        grabbedSymbol = {
                           kind,
                           grabOffset: new Vector(
                              (cameraZoom * -kind.svgBox.width()) / 2,
                              (cameraZoom * -kind.svgBox.height()) / 2
                           ),
                        }
                     }}
                  >
                     <div class="symbolName">
                        {kind.fileName.replace(".svg", "")}
                     </div>
                     <div
                        class="symbolImage"
                        style="background-image: url('{filePathOfSymbol(
                           kind.fileName
                        )}')"
                     />
                  </div>
               {/each}
            </div>
         {:else if projectFolder}
            <div class="symbolPaneMessage">
               Failed to find a "symbol" folder within the project folder.
            </div>
         {:else}
            <div class="symbolPaneMessage">
               <p>
                  When you open a project folder, your schematic symbols will be
                  displayed here.
               </p>
               <div class="spacer" />
               <p>
                  The SVG files for each symbol must be placed in a folder named
                  "symbols" within the project folder.
               </p>
            </div>
         {/if}
      </div>
      <div class="configPane">
         {#each Object.values(config) as item}
            <div class="configItem" on:click={() => toggleConfig(item)}>
               <div
                  class="configImage"
                  style="background-image: url('{item.icon}')"
               />
               <div>{item.state}</div>
               <div
                  class="configTooltip"
                  style="left: {mouseInClient.x + 8}px; top: {mouseInClient.y +
                     18}px"
               >
                  {item.tooltip}
               </div>
            </div>
         {/each}
      </div>
      <div class="toolbox">
         {#each row1Tools as tool}
            <Button
               label={labelOfButton(tool)}
               isHeld={heldTool?.tool === tool}
               shouldBind={heldTool?.tool === tool && heldTool.shouldBind}
               isBound={boundTool === tool}
               on:mousedown={() => {
                  boundTool = tool
               }}
            />
         {/each}
         {#each row2Tools as tool}
            <Button
               label={labelOfButton(tool)}
               isHeld={heldTool?.tool === tool}
               shouldBind={heldTool?.tool === tool && heldTool.shouldBind}
               isBound={boundTool === tool}
               on:mousedown={() => {
                  boundTool = tool
               }}
            />
         {/each}
      </div>
   </div>
   {#if grabbedSymbol}
      <img
         class="grabbedSymbolImage"
         src={filePathOfSymbol(grabbedSymbol.kind.fileName)}
         alt=""
         style="{absolutePosition(
            mouseInClient.displacedBy(grabbedSymbol.grabOffset)
         )}; width: {cameraZoom *
            grabbedSymbol.kind.svgBox.width()}px; height: {cameraZoom *
            grabbedSymbol.kind.svgBox.height()}px;"
      />
   {/if}
</div>

<div id="resources" style="visibility: hidden">
   <!-- Load each kind of symbol as an invisible <object>, and pre-process it
   as necessary. We will clone an <object>'s DOM content when the corresponding
   symbol needs to be instantiated on the main drawing canvas. -->
   <!-- N.B: display:none doesn't work: it prevents the objects from loading.-->
   {#if symbolFiles}
      {#each symbolFiles as fileName}
         <object
            id={fileName}
            type="image/svg+xml"
            data={filePathOfSymbol(fileName)}
            title=""
            on:load={() => registerSymbolKind(fileName)}
         />
      {/each}
   {/if}
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
   :global(.grab.stroke) {
      stroke: white;
      fill: none;
   }
   :global(.grab.fill) {
      fill: white;
   }
   :global(.debug.stroke) {
      stroke: #e58a00;
      fill: none;
   }
   :global(.debug.fill) {
      fill: #e58a00;
   }
   div {
      font: 14px sans-serif;
   }
   p {
      margin: 0;
   }
   .spacer {
      height: 8px;
   }
   .sidebar {
      position: absolute;
      top: 0;
      left: 0;
      width: 254px;
      height: 100%;
      background-color: rgb(231, 234, 237);
      box-shadow: 0 0 8px 0 rgb(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
   }
   .projectPane {
      padding: 4px;
      border-bottom: 1px solid black;
      display: flex;
      flex-direction: column;
      gap: 4px;
   }
   .symbolPane {
      flex-grow: 1;
      overflow-x: hidden;
      overflow-y: scroll;
      background-color: rgb(90, 90, 90);
   }
   .symbolPaneMessage {
      padding: 4px;
      background-color: rgb(193, 195, 199);
   }
   .symbolGrid {
      display: flex;
      flex-direction: column;
      gap: 1px;
      user-select: none;
      -webkit-user-select: none;
   }
   .symbolGridItem {
      height: 80px;
      padding: 4px;
      background-color: rgb(193, 195, 199);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
   }
   .symbolImage {
      flex: 1;
      width: 100%;
      background-size: contain;
      background-repeat: no-repeat;
   }
   .grabbedSymbolImage {
      pointer-events: none;
   }
   .configPane {
      height: 48px;
      display: flex;
      flex-direction: row;
      user-select: none;
      -webkit-user-select: none;
   }
   .configItem {
      flex: 1;
      padding: 5px;
      padding-bottom: 2px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
   }
   .configImage {
      flex: 1;
      width: 100%;
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
   }
   .configTooltip {
      position: absolute;
      visibility: hidden;
      pointer-events: none;
   }
   .configItem:hover .configTooltip {
      visibility: visible;
      width: 140px;
      padding: 2px;
      background-color: white;
      box-shadow: 0 0 8px 0 rgb(0, 0, 0, 0.3);
   }
   .toolbox {
      border-top: 1px solid black;
      display: grid;
      grid-template-rows: 50px 50px;
      grid-template-columns: repeat(5, 50px);
      gap: 1px;
      background-color: rgb(58, 58, 58);
   }
   svg {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
   }
</style>
