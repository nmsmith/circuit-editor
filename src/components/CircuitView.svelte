<script lang="ts">
   import { onMount } from "svelte"
   import {
      Vertex,
      isVertex,
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
      Range1D,
      Range2D,
      ClosenessResult,
      closestTo,
      closestSegmentTo,
   } from "~/shared/geometry"
   import * as Geometry from "~/shared/geometry"
   import {
      mouseInCoordinateSystemOf,
      DefaultMap,
      ToggleSet,
   } from "~/shared/utilities"
   import FluidLine from "~/components/lines/FluidLine.svelte"
   import Hopover from "~/components/lines/Hopover.svelte"
   import JunctionNode from "~/components/lines/JunctionNode.svelte"
   import PointMarker from "~/components/PointMarker.svelte"
   import RectSelectBox from "~/components/RectSelectBox.svelte"
   import Plug from "~/components/lines/Plug.svelte"
   import Button from "./Button.svelte"
   import Heap from "heap"

   // ---------------------- Props (for input & output) -----------------------
   // Callbacks that must be bound by the parent component.
   // export let onSymbolLeave: (
   //    kind: SymbolKind,
   //    grabOffset: Vector,
   //    event: MouseEvent
   // ) => void
   // Callbacks shared with the parent component.
   export const onSymbolEnter = spawnSymbol

   // ------------------------------ Constants --------------------------------
   let canvas: SVGElement // the root element of this component
   type Button = keyof typeof button
   export const buttonMap: {
      LMB: Button
      RMB: Button
      KeyQ: Button
      KeyW: Button
      KeyE: Button
      KeyR: Button
      KeyT: Button
      KeyA: Button
      KeyS: Button
      KeyD: Button
      KeyF: Button
      KeyG: Button
   } = {
      LMB: "draw",
      RMB: "nothing",
      KeyQ: "query",
      KeyW: "warp",
      KeyE: "erase",
      KeyR: "rigid",
      KeyT: "tether",
      KeyA: "aButton",
      KeyS: "slide",
      KeyD: "draw",
      KeyF: "flex",
      KeyG: "gButton",
   }
   const row1Buttons: Button[] = ["query", "warp", "erase", "rigid", "tether"]
   const row2Buttons: Button[] = ["aButton", "slide", "draw", "flex", "gButton"]
   export const buttonForSidebarDragging: Button = "warp"
   function buttonOf(key: string): Button | undefined {
      return buttonMap[key as keyof typeof buttonMap]
   }
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   // Configurable constants
   const sqMinSegmentLength = 15 * 15
   const sqSelectStartDistance = 8 * 8
   // Circuit-sizing constants
   const standardGap = 30 // standard spacing between scene elements
   const halfGap = standardGap / 2
   const hopoverRadius = halfGap / 2
   // Snapping constants
   const easeRadius = 30 // dist btw mouse & snap point at which easing begins
   const snapRadius = 12 // dist btw mouse & snap point at which snapping occurs
   const snapJump = 5 // the distance things move at the moment they snap
   const sqEaseRadius = easeRadius * easeRadius
   const sqSnapRadius = snapRadius * snapRadius
   const sqInteractRadius = sqSnapRadius
   // The major axes that drawing occurs along.
   const primaryAxes = [Axis.horizontal, Axis.vertical]
   const snapAxes = [
      Axis.horizontal,
      Axis.vertical,
      Axis.fromAngle(0.125 * tau), // 45 degrees
      Axis.fromAngle(0.375 * tau), // 135 degrees
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
   type Selectable = Grabbable
   type Movable = Junction | SymbolInstance // Things that move when dragged.
   function isMovable(thing: any): thing is Movable {
      return thing instanceof Junction || thing instanceof SymbolInstance
   }
   function movableAt(vertex: Vertex): Movable {
      return vertex instanceof Junction ? vertex : vertex.symbol
   }
   function* vertices(): Generator<Vertex> {
      for (let v of Junction.s) yield v
      for (let v of Port.s) yield v
   }
   function* crossings(): Generator<Crossing> {
      for (let [seg1, map] of crossingMap) {
         for (let [seg2, point] of map) yield new Crossing(seg1, seg2, point)
      }
   }
   function* movables(): Generator<Movable> {
      for (let m of Junction.s) yield m
      for (let m of SymbolInstance.s) yield m
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
      alongAxis: Axis
   ): ClosenessResult<Segment> {
      let closest = closestSegmentTo(point, alongAxis, Segment.s)
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
      return closestNearTo(point, vertices()) || closestNearTo(point, Segment.s)
   }
   function closestToggleable(point: Point): ClosenessResult<Toggleable> {
      return (
         closestNearTo<Vertex | Crossing>(point, vertices(), crossings()) ||
         closestNearTo(point, Segment.s)
      )
   }
   function closestAttachableOrToggleable(
      point: Point
   ): ClosenessResult<Attachable | Toggleable> {
      // This additional function is necessary because the individual functions
      // don't compose.
      return (
         closestNearTo<Vertex | Crossing>(point, vertices(), crossings()) ||
         closestNearTo(point, Segment.s)
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
      return (
         junction.edges().size === 1 && junction.axes()[0] === drawAxis && !alt
      )
   }
   function nearestAxis(to: Axis, ofAxes: Axis[]): Axis {
      let scores = ofAxes.map((axis) => Math.abs(to.dot(axis)))
      return ofAxes[scores.indexOf(Math.max(...scores))]
   }
   function aButtonIsHeld(): boolean {
      return Object.values(button).some((k) => k.state)
   }
   function selectedDrawMode(): DrawMode {
      return alt ? (shift ? "free rotation" : "snapped rotation") : "strafing"
   }
   function labelOfButton(s: string): string {
      if (s.endsWith("Button")) return s[0].toUpperCase()
      else return s[0].toUpperCase() + s.slice(1)
   }

   // ---------------------- State of input peripherals -----------------------
   let mouse: Point = Point.zero
   let [shift, alt, cmd] = [false, false, false]
   type ButtonDownInfo = {
      downTime: number
      downPosition: Point
      downJunction?: Junction
   }
   type ButtonState =
      | { state: null } // 'null' is more convenient than the string "up".
      // Pressing, but not yet moved enough to constitute a drag.
      | ({ state: "pressing" } & ButtonDownInfo)
      | ({ state: "dragging" } & ButtonDownInfo)
   let button: {
      query: ButtonState
      warp: ButtonState
      erase: ButtonState
      rigid: ButtonState
      tether: ButtonState
      aButton: ButtonState
      slide: ButtonState
      draw: ButtonState
      flex: ButtonState
      gButton: ButtonState
      nothing: ButtonState // A dummy button.
   } = {
      query: { state: null },
      warp: { state: null },
      erase: { state: null },
      rigid: { state: null },
      tether: { state: null },
      aButton: { state: null },
      slide: { state: null },
      draw: { state: null },
      flex: { state: null },
      gButton: { state: null },
      nothing: { state: null },
   }
   let [lmbShouldBeDown, rmbShouldBeDown] = [false, false]
   // This is a hack that I'm using to have the act of dragging from the
   // sidebar be interpreted as a move operation, irrespective of what
   // operation the LMB is actually mapped to.
   let lmbShouldSimulate: keyof typeof button | null = null

   // ------------------------- Primary editor state --------------------------
   // Note: This is the state of the editor. The circuit is stored elsewhere.
   type DrawMode = "strafing" | "snapped rotation" | "free rotation"
   let draw: null | {
      mode: DrawMode
      segment: Segment
      end: Junction
      segmentIsNew: boolean
      shouldEaseIn: boolean
      endObject?: Attachable
   }
   type SlideInstruction = { movable: Movable; delay: number }
   // & (
   //    | { type: "simple" }
   //    | { type: "composite"; direction: Direction; distance: number }
   // )
   let slide: null | {
      originalPositions: DefaultMap<Movable | Vertex, Point>
      partGrabbed: Point
      axis: Axis
      posInstructionsFull: SlideInstruction[]
      negInstructionsFull: SlideInstruction[]
      posInstructionsConn: SlideInstruction[]
      negInstructionsConn: SlideInstruction[]
      distance: number
   } = null
   let warp: null | {
      movable: Movable
      offset: Vector
   }
   let multiSelect: null | {
      mode: "new" | "add" | "remove"
      start: Point
      items: Set<Selectable>
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
   let selected: ToggleSet<Selectable> = new ToggleSet()

   // ---------------------------- Derived state ------------------------------
   $: canvasWidth = canvas ? canvas.getBoundingClientRect().width : 0
   $: canvasHeight = canvas ? canvas.getBoundingClientRect().height : 0
   let unconfirmedSelected: Set<Selectable>
   $: /* Combine the confirmed selection with the selection-in-progress.  */ {
      unconfirmedSelected = new Set(selected)
      if (multiSelect) {
         if (multiSelect.mode === "remove") {
            for (let item of multiSelect.items) unconfirmedSelected.delete(item)
         } else {
            for (let item of multiSelect.items) unconfirmedSelected.add(item)
         }
      }
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
      } else if (button.slide.state) {
         if (closestGrabbable(mouse)) {
            cursor = button.slide.state === "pressing" ? "grabbing" : "grab"
         } else {
            cursor = "default"
         }
      } else if (multiSelect || eraseSelect || rigidSelect || flexSelect) {
         cursor = "default"
      } else {
         cursor = "cell"
      }
   }
   let highlighted: Set<Highlightable>
   $: /* Highlight objects near the mouse cursor. */ {
      highlighted = new Set()
      if (draw?.endObject instanceof Segment) {
         highlighted.add(draw.endObject)
      } else if (!aButtonIsHeld()) {
         let thing = closestAttachableOrToggleable(mouse)
         if (thing) {
            if (thing.object instanceof Crossing) {
               highlighted.add(thing.closestPart)
            } else {
               highlighted.add(thing.object)
            }
         }
      }
   }
   type HighlightStyle = "hover" | "select" | undefined
   $: styleOf = function (thing: Highlightable | Selectable): HighlightStyle {
      // This function _must_ be defined within $, because its behaviour changes
      // whenever the state below changes, and Svelte needs to know that.
      if (unconfirmedSelected.has(thing as Selectable)) return "select"
      else if (highlighted.has(thing)) return "hover"
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
            } else if (type === "no hop" && highlighted.has(crossPoint)) {
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
      for (let v of vertices()) {
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
               highlighted.has(v) ||
               unconfirmedSelected.has(v)
            ) {
               glyphsToDraw.add({
                  type: "point marker",
                  point: v,
                  style: styleOf(v),
               })
            }
         } else if (v instanceof Port && highlighted.has(v)) {
            glyphsToDraw.add({
               type: "point marker",
               point: v,
               style: styleOf(v),
            })
         }
      }
      if (draw) {
         glyphsToDraw.add({
            type: "point marker",
            point: draw.end,
            style: "select",
         })
      }
   }

   // ---------------------------- Primary events -----------------------------
   function buttonSelected(name: keyof typeof button) {
      buttonMap.LMB = name
   }
   function buttonPressed(name: keyof typeof button) {
      let instantActionPossible = buttonMap.LMB === name
      // This function abstracts over mouse and keyboard events.
      if ((name === "rigid" || name === "flex") && button.draw.state) {
         chainDraw(name === "rigid")
      } else {
         abortAndReleaseAll()
         button[name] = {
            state: "pressing",
            downTime: performance.now(),
            downPosition: mouse,
         }
         if (name === "rigid" && instantActionPossible) {
            let segment = closestNearTo(mouse, Segment.s)?.object
            if (segment?.isRigid === false) {
               segment.isRigid = true
               Segment.s = Segment.s
            }
         } else if (name === "flex" && instantActionPossible) {
            let segment = closestNearTo(mouse, Segment.s)?.object
            if (segment?.isRigid) {
               segment.isRigid = false
               Segment.s = Segment.s
            }
         }
      }
   }
   function buttonReleased(name: keyof typeof button) {
      let b = button[name]
      if (!b.state) return
      if (b.state === "pressing" && buttonMap.LMB !== name) {
         // The button was tapped.
         buttonSelected(name)
      } else {
         switch (name) {
            case "warp":
               endWarp()
               break
            case "draw": {
               if (b.state === "pressing" && !b.downJunction) {
                  drawButtonTapped()
               } else if (b.state === "dragging") {
                  endDraw()
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
      }
      button[name] = { state: null }
   }
   function updateModifierKeys(event: KeyboardEvent | MouseEvent) {
      shift = event.getModifierState("Shift")
      alt = event.getModifierState("Alt")
      cmd = event.getModifierState("Control") || event.getModifierState("Meta")
      if (draw?.mode !== selectedDrawMode()) {
         updateDraw()
         updateSlide()
      }
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
      let toggle = closestToggleable(mouse)
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
   function mouseMoved(previousMousePosition: Point) {
      if (slide) slide.distance += mouse.distanceFrom(previousMousePosition)
      // Update the actions that depend on mouse movement. (It's important that
      // these updates are invoked BEFORE any begin___() functions. The begin___
      // funcs may induce changes to derived data that the updates need to see.)
      updateDraw()
      updateSlide()
      updateWarp()
      updateEraseSelect()
      updateRigidSelect()
      updateFlexSelect()
      // Check for the initiation of drag-based operations.
      if (button.draw.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.draw.downPosition)
         if (dragVector.sqLength() >= halfGap * halfGap) {
            button.draw = { ...button.draw, state: "dragging" }
            beginDraw(dragVector)
         }
      }
      if (button.warp.state === "pressing") {
         let grabbed = closestMovable(button.warp.downPosition)
         let dragVector = mouse.displacementFrom(button.warp.downPosition)
         if (grabbed && dragVector.sqLength() >= halfGap * halfGap) {
            button.warp = { ...button.warp, state: "dragging" }
            beginWarp(grabbed.object, grabbed.closestPart)
         }
      }
      if (button.slide.state === "pressing") {
         let grabbed = closestGrabbable(button.slide.downPosition)
         let dragVector = mouse.displacementFrom(button.slide.downPosition)
         if (grabbed && dragVector.sqLength() >= halfGap * halfGap) {
            button.slide = { ...button.slide, state: "dragging" }
            let dragAxis = Axis.fromVector(dragVector)
            if (dragAxis) {
               let slideAxis = nearestAxis(dragAxis, primaryAxes)
               beginSlide(slideAxis, grabbed.object, grabbed.closestPart)
            }
         }
      }
      if (button.erase.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.erase.downPosition)
         if (dragVector.sqLength() >= sqSelectStartDistance) {
            button.erase = { ...button.erase, state: "dragging" }
            beginEraseSelect(button.erase.downPosition)
         }
      }
      if (button.rigid.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.rigid.downPosition)
         if (dragVector.sqLength() >= sqSelectStartDistance) {
            button.rigid = { ...button.rigid, state: "dragging" }
            beginRigidSelect(button.rigid.downPosition)
         }
      }
      if (button.flex.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.flex.downPosition)
         if (dragVector.sqLength() >= sqSelectStartDistance) {
            button.flex = { ...button.flex, state: "dragging" }
            beginFlexSelect(button.flex.downPosition)
         }
      }
   }
   function spawnSymbol(
      kind: SymbolKind,
      grabOffset: Vector,
      e: MouseEvent,
      draggingUsingLMB: boolean
   ) {
      // Update the mouse position.
      mouse = mouseInCoordinateSystemOf(canvas, e)
      // Spawn a symbol on the canvas, and initiate a move action.
      let spawnPosition = mouse.displacedBy(grabOffset)
      let symbol = new SymbolInstance(kind, spawnPosition, Rotation.zero)
      beginWarp(symbol, mouse)
      button.warp = {
         state: "dragging",
         downTime: performance.now(),
         downPosition: mouse,
      }
      if (draggingUsingLMB) {
         // Set some flags so that when the LMB is released, the move operation
         // is terminated.
         lmbShouldBeDown = true
         lmbShouldSimulate = "warp"
      }
   }

   // ---------------------------- Derived events -----------------------------
   function beginDraw(dragVector: Vector) {
      if (button.draw.state !== "dragging") return
      let drawMode = selectedDrawMode()
      if (button.draw.downJunction) {
         // Start the draw operation at the endpoint of the previous
         // draw operation.
         let lastDrawAxis = button.draw.downJunction.axes()[0]
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
         newDraw(button.draw.downJunction, drawAxis)
         return
      } else if (
         closestAttachableOrToggleable(button.draw.downPosition)
            ?.object instanceof Crossing
      ) {
         return // Don't allow draw operations to start at crossings.
      }
      // Otherwise, start the draw operation at the closest attachable.
      let attach = closestAttachable(button.draw.downPosition)
      // Determine the axis the draw operation should begin along.
      let dragAxis = Axis.fromVector(dragVector) as Axis
      let standardAxes =
         drawMode === "strafing"
            ? primaryAxes
            : drawMode === "snapped rotation"
            ? snapAxes
            : [dragAxis]
      if (attach?.object instanceof Segment) {
         let segment = attach.object
         let closestPart = attach.closestPart
         let drawAxis =
            drawMode === "strafing"
               ? nearestAxis(dragAxis, [...standardAxes, segment.axis])
               : drawMode === "snapped rotation"
               ? nearestAxis(dragAxis, standardAxes)
               : dragAxis
         if (drawMode !== "free rotation" && drawAxis === segment.axis) {
            // Cut the segment, and allow the user to move one side of it.
            let direction = segment.start.displacementFrom(closestPart)
            let [newStart, other] =
               direction.dot(dragVector) > 0
                  ? [segment.start, segment.end]
                  : [segment.end, segment.start]
            let jMove = new Junction(closestPart)
            let jOther = new Junction(closestPart)
            let moveSegment = new Segment(newStart, jMove, drawAxis)
            let otherSegment = new Segment(other, jOther, drawAxis)
            segment.replaceWith(moveSegment, otherSegment)
            continueDraw(moveSegment, jMove)
         } else {
            // Create a T-junction.
            let junction = new Junction(closestPart)
            segment.splitAt(junction)
            newDraw(junction, drawAxis)
         }
      } else if (attach) {
         let vertex = attach.object
         let continuedDraw = false
         if (drawMode !== "free rotation") {
            let considerAxis =
               drawMode === "strafing"
                  ? // Consider vertex axes, in case the user wants to
                    // extend/unplug a segment.
                    nearestAxis(dragAxis, [...standardAxes, ...vertex.axes()])
                  : nearestAxis(dragAxis, standardAxes)
            if (
               vertex instanceof Junction &&
               shouldExtendTheSegmentAt(vertex, considerAxis)
            ) {
               // Extend the segment.
               continueDraw([...vertex.edges()][0][0], vertex)
               continuedDraw = true
            } else {
               for (let [segment, other] of vertex.edges()) {
                  if (segment.axis !== considerAxis) continue
                  if (other.displacementFrom(vertex).dot(dragVector) <= 0)
                     continue
                  // Unplug this segment from the vertex.
                  let junction = new Junction(vertex)
                  let newSegment = new Segment(other, junction, considerAxis)
                  segment.replaceWith(newSegment)
                  if (vertex instanceof Junction && vertex.edges().size === 2)
                     vertex.convertToCrossing(crossingMap)
                  // Allow the user to move the unplugged segment around.
                  continueDraw(newSegment, junction)
                  continuedDraw = true
                  break
               }
            }
         }
         if (!continuedDraw)
            newDraw(vertex, nearestAxis(dragAxis, standardAxes))
      } else
         newDraw(
            new Junction(button.draw.downPosition),
            nearestAxis(dragAxis, standardAxes)
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
         shouldEaseIn: false,
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
         shouldEaseIn: mode === "strafing",
      }
      if (mode === "strafing") beginDrawStrafing()
   }
   function beginDrawStrafing() {
      if (!draw) return
      let thingToMove = movableAt(draw.segment.start)
      let axes = thingToMove.axes()
      let drawAxis = draw.segment.axis
      let slideAxis
      if (axes.length === 1 && axes[0] !== drawAxis) {
         slideAxis = axes[0]
      } else if (axes.length === 2 && axes.includes(drawAxis)) {
         slideAxis = axes[0] === drawAxis ? axes[1] : axes[0]
      } else {
         slideAxis = drawAxis.orthogonal()
      }
      beginSlide(slideAxis, thingToMove, draw.segment.start)
   }
   function updateDraw() {
      if (!draw) return

      if (draw.mode !== selectedDrawMode()) {
         // Change the draw mode.
         endSlide() // If we were sliding, commit the operation.
         draw.shouldEaseIn = false
         draw.mode = selectedDrawMode()
         if (draw.mode === "strafing") beginDrawStrafing()
      }
      if (draw.mode === "snapped rotation") {
         let dragVector = mouse.displacementFrom(draw.segment.start)
         let dragAxis = Axis.fromVector(dragVector)
         if (dragAxis) {
            // Snap to the nearest standard axis.
            let drawAxis = nearestAxis(dragAxis, snapAxes)
            ;(draw.segment.axis as Axis) = drawAxis
            // Try snapping the endpoint to nearby segments.
            let end = draw.segment.start.displacedBy(
               dragVector.projectionOnto(drawAxis)
            )
            let s = closestSegmentNearTo(end, drawAxis)
            if (s) {
               draw.end.moveTo(s.closestPart)
               draw.endObject = s.object
            } else {
               draw.end.moveTo(end)
               draw.endObject = undefined
            }
         }
      } else {
         let associatedDrawAxis: (vertex: Vertex) => Axis | undefined
         let defaultDrawAxis: Axis | undefined
         if (draw.mode === "strafing") {
            associatedDrawAxis = () => draw!.segment.axis
            defaultDrawAxis = draw.segment.axis
         } else {
            // draw.mode === "free rotation"
            associatedDrawAxis = (vertex: Vertex) =>
               Axis.fromVector(vertex.displacementFrom(draw!.segment.start))
            defaultDrawAxis = Axis.fromVector(
               mouse.displacementFrom(draw.segment.start)
            )
         }
         function isAcceptable(vertex: Vertex) {
            if (vertex === draw!.end) return false
            let start = draw!.segment.start
            let drawAxis = associatedDrawAxis(vertex)
            if (!drawAxis) return false
            for (let [{ axis }, other] of vertex.edges()) {
               // Reject if the segment being drawn would overlap this seg.
               if (
                  axis === drawAxis &&
                  other.distanceFrom(start) + 1 <
                     vertex.distanceFrom(start) + other.distanceFrom(vertex)
               )
                  return false
            }
            return true
         }
         let acceptableVertices = Array.from(vertices()).filter(isAcceptable)
         let closest = closestNearTo(mouse, acceptableVertices)
         let drawAxis = closest
            ? associatedDrawAxis(closest.object)
            : defaultDrawAxis
         if (drawAxis) {
            ;(draw.segment.axis as Axis) = drawAxis
            if (closest) {
               draw.end.moveTo(closest.object)
               draw.endObject = closest.object
            } else {
               // Try snapping the endpoint to nearby segments.
               let s = closestSegmentNearTo(mouse, drawAxis)
               if (s) {
                  draw.end.moveTo(s.closestPart)
                  draw.endObject = s.object
               } else {
                  draw.end.moveTo(mouse)
                  draw.endObject = undefined
               }
            }
         }
      }
      Junction.s = Junction.s
      Segment.s = Segment.s
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
      if (draw?.segmentIsNew) deleteItems([draw.end])
   }
   function chainDraw(rigidifyCurrent: boolean) {
      if (!draw) return
      draw.segment.isRigid = rigidifyCurrent
      // Start a new draw operation at the current draw endpoint.
      button.draw = {
         state: "pressing",
         downTime: performance.now(),
         downPosition: mouse,
         downJunction: draw.end,
      }
      draw.endObject = undefined // Don't connect to anything else.
      endDraw(false)
   }
   function beginSlide(slideAxis: Axis, grabbed: Grabbable, atPart: Point) {
      let orthogonalAxis = slideAxis.orthogonal()
      let partGrabbed = atPart.clone()
      // Before movement commences, record the position of every Movable.
      // We need to use the original positions as a reference, because we will
      // be mutating them over the course of the movement.
      let originalPositions = new DefaultMap<Movable | Vertex, Point>(
         () => Point.zero
      )
      for (let junction of Junction.s) {
         originalPositions.set(junction, junction.clone())
      }
      for (let symbol of SymbolInstance.s) {
         originalPositions.set(symbol, symbol.position.clone())
         for (let port of symbol.ports)
            originalPositions.set(port, port.clone())
      }
      function generateInstructions(
         slideDir: Direction,
         shouldPushNonConnected: boolean
      ): SlideInstruction[] {
         let instructions: SlideInstruction[] = [] // the final sequence

         // ------------- PART 1: Definitions and required data. --------------
         type Pushable = Junction | Segment | SymbolInstance
         function* pushables() {
            for (let p of Junction.s) yield p
            for (let p of Segment.s) yield p
            for (let p of SymbolInstance.s) yield p
         }
         // "slideRanges" stores the extent of Pushables in the slide direction,
         // whilst "orthRanges" stores their extent in the orthogonal direction.
         let slideRanges = new Map<Pushable, Range1D>()
         let orthRanges = new Map<Pushable, Range1D>()
         for (let junction of Junction.s) {
            let d = junction.displacementFrom(Point.zero)
            let s = d.scalarProjectionOnto(slideDir)
            let o = d.scalarProjectionOnto(orthogonalAxis)
            slideRanges.set(junction, new Range1D(s, s))
            orthRanges.set(junction, new Range1D(o, o))
         }
         for (let segment of Segment.s) {
            if (segment.axis !== orthogonalAxis) continue
            // We only need to consider orthogonal segments.
            let dStart = segment.start.displacementFrom(Point.zero)
            let dEnd = segment.end.displacementFrom(Point.zero)
            let sStart = dStart.scalarProjectionOnto(slideDir)
            let sEnd = dEnd.scalarProjectionOnto(slideDir)
            let oStart = dStart.scalarProjectionOnto(orthogonalAxis)
            let oEnd = dEnd.scalarProjectionOnto(orthogonalAxis)
            slideRanges.set(segment, new Range1D(sStart, sEnd))
            orthRanges.set(segment, new Range1D(oStart, oEnd))
         }
         for (let symbol of SymbolInstance.s) {
            let symbolAxis = Axis.fromDirection(
               Direction.positiveX.rotatedBy(symbol.rotation)
            )
            if (symbolAxis === slideAxis || symbolAxis === orthogonalAxis) {
               slideRanges.set(symbol, rangeAlong(slideDir, symbol))
               orthRanges.set(symbol, rangeAlong(orthogonalAxis, symbol))
            }
         }
         function rangeAlong(dir: Vector, symbol: SymbolInstance): Range1D {
            return new Range1D(
               ...symbol
                  .corners()
                  .map((corner) =>
                     corner
                        .displacementFrom(Point.zero)
                        .scalarProjectionOnto(dir)
                  )
            )
         }

         // ------------------ PART 2: Initialize the heap. -------------------
         // Instructions need to be scheduled in order of priority. Thus, as
         // instructions are proposed, we insert them into a heap.
         let heap = new Heap<SlideInstruction>((a, b) => a.delay - b.delay)
         // Proposals are also stored in a Map, so that we can update them.
         let proposals = new Map<Movable, SlideInstruction>()
         // Add the initial proposals to the heap.
         if (grabbed instanceof Segment) {
            let i1 = { movable: movableAt(grabbed.start), delay: 0 }
            let i2 = { movable: movableAt(grabbed.end), delay: 0 }
            heap.push(i1)
            heap.push(i2)
            proposals.set(movableAt(grabbed.start), i1)
            proposals.set(movableAt(grabbed.end), i2)
         } else {
            let i = { movable: grabbed, delay: 0 }
            heap.push(i)
            proposals.set(grabbed, i)
         }

         // --------------- PART 3: Generate the instructions. ----------------
         while (heap.size() > 0) {
            let nextInstruction = heap.pop() as SlideInstruction
            let { movable, delay } = nextInstruction
            instructions.push(nextInstruction) // Finalize this instruction.

            function pushNonConnected(pusher: Pushable) {
               if (!slideRanges.has(pusher)) return
               let pusherSlide = slideRanges.get(pusher) as Range1D
               let pusherOrthogonal = orthRanges.get(pusher) as Range1D
               for (let target of pushables()) {
                  if (!slideRanges.has(target)) continue
                  let targetOrthogonal = orthRanges.get(target) as Range1D
                  if (!pusherOrthogonal.intersects(targetOrthogonal)) continue
                  let targetSlide = slideRanges.get(target) as Range1D
                  let displacement = targetSlide.displacementFrom(pusherSlide)
                  if (displacement <= 0) continue
                  let distance = Math.max(0, displacement - standardGap)
                  if (target instanceof Segment) {
                     proposeTo(movableAt(target.start), delay + distance)
                     proposeTo(movableAt(target.end), delay + distance)
                  } else {
                     proposeTo(target, delay + distance)
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
               if (!segment.isRigid && adjDir.approxEquals(slideDir, 0.1)) {
                  // Allow the edge to contract to a length of standardGap.
                  let contraction = Math.max(0, segment.length() - standardGap)
                  proposeTo(movableAt(adjVertex), delay + contraction)
               } else if (!segment.isRigid && segment.axis === slideAxis) {
                  // The segment can stretch indefinitely.
                  continue
               } else {
                  proposeTo(movableAt(adjVertex), delay)
               }
            }
         }
         function proposeTo(movable: Movable, delay: number) {
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
               let proposal = { movable: movable, delay }
               heap.push(proposal)
               proposals.set(movable, proposal)
            }
         }
         return instructions
      }
      let [pos, neg] = [slideAxis.posDirection(), slideAxis.negDirection()]
      slide = {
         originalPositions,
         partGrabbed,
         axis: slideAxis,
         posInstructionsFull: generateInstructions(pos, true),
         negInstructionsFull: generateInstructions(neg, true),
         posInstructionsConn: generateInstructions(pos, false),
         negInstructionsConn: generateInstructions(neg, false),
         distance: 0,
      }
   }
   function updateSlide() {
      if (!slide) return
      let downPosition: Point
      if (button.draw.state === "dragging") {
         downPosition = button.draw.downPosition
      } else if (button.slide.state === "dragging") {
         downPosition = button.slide.downPosition
      } else return
      // Revert the previous movement.
      for (let m of movables()) {
         if (draw && m === draw.end) continue
         m.moveTo(slide.originalPositions.read(m))
      }
      // Determine the direction and distance things should move.
      let slideDistance: number
      let shouldSnap: boolean
      if (draw) {
         // The slideDistance has already been determined by updateDraw().
         // Move just enough to "straighten out" the line being drawn.
         let [slideVector] = draw.end
            .displacementFrom(draw.segment.start)
            .inTermsOfBasis([slide.axis, draw.segment.axis])
         slideDistance = slideVector.scalarProjectionOnto(slide.axis)
         shouldSnap = false
      } else {
         // The slideDistance will be determined here.
         slideDistance = mouse
            .displacementFrom(slide.partGrabbed)
            .scalarProjectionOnto(slide.axis)
         shouldSnap = true
      }
      // if (slide.distance < 15 && (!draw || draw.shouldEaseIn)) {
      //    // The user may have grabbed slightly-away from their target object.
      //    // If so, gradually pull the object towards the mouse cursor.
      //    dragVector = mouse.displacementFrom(
      //       downPosition.interpolatedToward(
      //          slide.partGrabbed,
      //          slide.distance / 15
      //       )
      //    )
      // } else {
      //    dragVector = mouse.displacementFrom(slide.partGrabbed)
      // }
      let direction, instructions
      if (slideDistance > 0) {
         direction = slide.axis.posDirection()
         instructions = shift
            ? slide.posInstructionsConn
            : slide.posInstructionsFull
      } else {
         direction = slide.axis.negDirection()
         instructions = shift
            ? slide.negInstructionsConn
            : slide.negInstructionsFull
         slideDistance = -slideDistance
      }
      if (!draw) {
         // If the current slideDistance is _close_ to the distance at which
         // two objects touch, ease toward that distance.
         let smallestDistance = Infinity
         for (let instruction of instructions) {
            if (instruction.delay === 0) continue
            let distance = slideDistance - instruction.delay
            if (Math.abs(distance) < Math.abs(smallestDistance))
               smallestDistance = distance
         }
         if (Math.abs(smallestDistance) <= snapRadius) {
            slideDistance -= smallestDistance
         } else if (Math.abs(smallestDistance) < easeRadius) {
            slideDistance -=
               Math.sign(smallestDistance) * easeFn(Math.abs(smallestDistance))
         }
      }
      // Perform the new movement.
      for (let instruction of instructions) {
         let distance = slideDistance - instruction.delay
         if (distance <= 0) break
         instruction.movable.moveBy(direction.scaledBy(distance))
      }
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function endSlide() {
      slide = null
   }
   function abortSlide() {
      if (!slide) return
      // TODO: This approach doesn't work if Alt or Shift are used during the
      // movement, since this resets slide.originalPositions. The "right" way to
      // cancel the slide will be to invoke the UNDO operation, once it is
      // implemented.

      // Move all the circuit elements back to their original positions.
      for (let m of movables()) m.moveTo(slide.originalPositions.read(m))
      slide = null
   }
   function beginWarp(movable: Movable, partGrabbed: Point) {
      let movablePos = movable instanceof Junction ? movable : movable.position
      warp = { movable, offset: movablePos.displacementFrom(partGrabbed) }
   }
   function updateWarp() {
      if (!warp) return
      warp.movable.moveTo(mouse.displacedBy(warp.offset))
      for (let [segment] of warp.movable.edges()) {
         let axis = Axis.fromVector(segment.end.displacementFrom(segment.start))
         if (!axis) continue
         ;(segment.axis as Axis) = axis
      }

      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function endWarp() {
      warp = null
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
      let range = Range2D.fromCorners(eraseSelect.start, mouse)
      for (let segment of Segment.s)
         if (range.intersects(segment)) eraseSelect.items.add(segment)
      for (let symbol of SymbolInstance.s)
         if (range.intersects(symbol)) eraseSelect.items.add(symbol)
   }
   function updateRigidSelect() {
      if (!rigidSelect) return
      rigidSelect.items = new Set()
      let range = Range2D.fromCorners(rigidSelect.start, mouse)
      for (let segment of Segment.s)
         if (range.intersects(segment)) rigidSelect.items.add(segment)
   }
   function updateFlexSelect() {
      if (!flexSelect) return
      flexSelect.items = new Set()
      let range = Range2D.fromCorners(flexSelect.start, mouse)
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
   function abortAndReleaseAll() {
      abortDraw()
      abortSlide()
      abortEraseSelect()
      abortRigidSelect()
      abortFlexSelect()
      for (let b of Object.keys(button) as Array<keyof typeof button>)
         buttonReleased(b)
      lmbShouldBeDown = false
      rmbShouldBeDown = false
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
      let b = buttonOf(event.code)
      if (b) buttonPressed(b)
   }}
   on:keyup={(event) => {
      updateModifierKeys(event)
      let b = buttonOf(event.code)
      if (b) buttonReleased(b)
   }}
   on:blur={() => {
      shift = false
      alt = false
      cmd = false
      abortAndReleaseAll()
   }}
/>

<svg
   bind:this={canvas}
   style="cursor: {cursor}"
   on:mousedown={(event) => {
      mouse = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (leftMouseIsDown(event) && !lmbShouldBeDown) {
         buttonPressed(buttonMap.LMB)
         lmbShouldBeDown = true
      }
      if (rightMouseIsDown(event) && !rmbShouldBeDown) {
         buttonPressed(buttonMap.RMB)
         rmbShouldBeDown = true
      }
   }}
   on:mousemove={(event) => {
      let previousMousePosition = mouse
      mouse = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event) && lmbShouldBeDown) {
         if (waitedOneFrameLMB) abortAndReleaseAll()
         else waitedOneFrameLMB = true
      } else {
         waitedOneFrameLMB = false
      }
      if (!rightMouseIsDown(event) && rmbShouldBeDown) {
         if (waitedOneFrameRMB) abortAndReleaseAll()
         else waitedOneFrameRMB = true
      } else {
         waitedOneFrameRMB = false
      }
      mouseMoved(previousMousePosition)
   }}
   on:mouseup={(event) => {
      mouse = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event) && lmbShouldBeDown) {
         buttonReleased(lmbShouldSimulate || buttonMap.LMB)
         lmbShouldBeDown = false
         lmbShouldSimulate = null
      }
      if (!rightMouseIsDown(event) && rmbShouldBeDown) {
         buttonReleased(lmbShouldSimulate || buttonMap.RMB)
         rmbShouldBeDown = false
         lmbShouldSimulate = null
      }
   }}
   on:mouseenter={(event) => {
      mouse = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event) && lmbShouldBeDown) abortAndReleaseAll()
      if (!rightMouseIsDown(event) && rmbShouldBeDown) abortAndReleaseAll()
   }}
>
   <!-- Symbol highlight/selection layer -->
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
   <!-- Segment highlight layer -->
   <g>
      {#each [...segmentsToDraw] as [segment, sections]}
         {#if highlighted.has(segment)}
            {#each sections as section}
               <FluidLine renderStyle="hover" segment={section} />
            {/each}
         {/if}
      {/each}
   </g>
   <!-- Segment selection layer -->
   <g>
      {#each [...segmentsToDraw] as [segment, sections]}
         {#if unconfirmedSelected.has(segment)}
            {#each sections as section}
               <FluidLine renderStyle="select" segment={section} />
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
                  isRigid={(segment.isRigid &&
                     !flexSelect?.items.has(segment)) ||
                     rigidSelect?.items.has(segment)}
               />
            {/if}
         {/each}
      {/each}
   </g>
   <!-- Lower glyph highlight/selection layer -->
   <g>
      {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
         {#if glyph.type === "point marker" && layerOf(glyph.point) === "lower"}
            <PointMarker renderStyle={glyph.style} position={glyph.point} />
         {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "lower"}
            <Plug renderStyle={glyph.style} position={glyph.vertex} />
         {:else if glyph.type === "junction node"}
            <JunctionNode renderStyle={glyph.style} position={glyph.junction} />
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
               isRigid={(glyph.segment.isRigid &&
                  !flexSelect?.items.has(glyph.segment)) ||
                  rigidSelect?.items.has(glyph.segment)}
            />
         {/if}
      {/each}
   </g>
   <!-- Symbol layer -->
   <g id="symbol layer" />
   <!-- Upper glyph highlight/selection layer -->
   <g>
      {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
         {#if glyph.type === "point marker" && layerOf(glyph.point) === "upper"}
            <PointMarker renderStyle={glyph.style} position={glyph.point} />
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
      <!-- Selection boxes -->
      <!-- {#if multiSelect}
         <RectSelectBox start={multiSelect.start} end={mouse} />
      {/if} -->
      {#if eraseSelect}
         <RectSelectBox start={eraseSelect.start} end={mouse} />
      {/if}
      {#if rigidSelect}
         <RectSelectBox start={rigidSelect.start} end={mouse} />
      {/if}
      {#if flexSelect}
         <RectSelectBox start={flexSelect.start} end={mouse} />
      {/if}
   </g>
</svg>

<div id="tool-bar">
   {#each row1Buttons as b}
      <Button
         label={labelOfButton(b)}
         isMouseButton={buttonMap.LMB === b}
         isPressed={button[b].state !== null}
         on:mousedown={() => {
            buttonSelected(b)
         }}
      />
   {/each}
   {#each row2Buttons as b}
      <Button
         label={labelOfButton(b)}
         isMouseButton={buttonMap.LMB === b}
         isPressed={button[b].state !== null}
         on:mousedown={() => {
            buttonSelected(b)
         }}
      />
   {/each}
</div>
/

<style>
   svg {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
   }
   #tool-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      display: grid;
      grid-template-rows: 50px 50px;
      grid-template-columns: repeat(5, 50px);
      gap: 1px;
      background-color: rgb(58, 58, 58);
      border-style: solid;
      border-color: black;
      border-width: 3px;
   }
</style>
