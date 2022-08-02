<script lang="ts">
   import { onMount } from "svelte"
   import {
      Vertex,
      isVertex,
      rememberAxis,
      findAxis,
      Junction,
      Port,
      Segment,
      CrossingType,
      Crossing,
      SymbolKind,
      SymbolInstance,
      convertToJunction,
      Edge,
   } from "~/shared/definitions"
   import {
      Object2D,
      Vector,
      Point,
      Rotation,
      Direction,
      Axis,
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
   import ToolButton from "./Toolbutton.svelte"
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
   const buttonMap: {
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
      Backquote: Button
   } = {
      LMB: "draw",
      RMB: "nothing",
      KeyQ: "query",
      KeyW: "weave",
      KeyE: "erase",
      KeyR: "relax",
      KeyT: "tether",
      KeyA: "operationA",
      KeyS: "slide",
      KeyD: "draw",
      KeyF: "freeze",
      KeyG: "operationG",
      Backquote: "debug",
   }
   function buttonOf(key: string): Button | undefined {
      return buttonMap[key as keyof typeof buttonMap]
   }
   const toolButtonSize = 56
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
   const gapSelectError = 1 // diff from standardGap acceptable to gap select
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
      findAxis(Axis.fromAngle(0.125 * tau)), // 45 degrees
      findAxis(Axis.fromAngle(0.375 * tau)), // 135 degrees
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

   // ---------------------------- Primary state ------------------------------
   // Note: This is the state of the editor. The circuit is stored elsewhere.
   let debug: boolean = false
   let mouse: Point = Point.zero
   let [shift, alt, cmd] = [false, false, false]
   type ButtonState =
      | { state: null } // 'null' is more convenient than the string "up".
      // Pressing, but not yet moved enough to constitute a drag.
      | { state: "pressing"; downPosition: Point; downJunction?: Junction }
      | { state: "dragging"; downPosition: Point; downJunction?: Junction }
   let button: {
      query: ButtonState
      weave: ButtonState
      erase: ButtonState
      relax: ButtonState
      tether: ButtonState
      slide: ButtonState
      draw: ButtonState
      freeze: ButtonState
      debug: ButtonState
      operationA: ButtonState
      operationG: ButtonState
      nothing: ButtonState // A dummy button.
   } = {
      query: { state: null },
      weave: { state: null },
      erase: { state: null },
      relax: { state: null },
      tether: { state: null },
      slide: { state: null },
      draw: { state: null },
      freeze: { state: null },
      debug: { state: null },
      operationA: { state: null },
      operationG: { state: null },
      nothing: { state: null },
   }
   let [lmbShouldBeDown, rmbShouldBeDown] = [false, false]
   let draw: null | {
      mode: "strafing" | "snapped rotation" | "free rotation"
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
      posInstructions: SlideInstruction[]
      negInstructions: SlideInstruction[]
      distance: number
   } = null
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
   let relaxSelect: SelectOperation<Segment>
   let freezeSelect: SelectOperation<Segment>
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
      } else if (button.slide.state || button.weave.state) {
         if (closestGrabbable(mouse)) {
            cursor =
               button.slide.state === "pressing" ||
               button.weave.state === "pressing"
                  ? "grabbing"
                  : "grab"
         } else {
            cursor = "default"
         }
      } else if (multiSelect || eraseSelect || relaxSelect || freezeSelect) {
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
   let chosenDrawMode: "strafing" | "snapped rotation" | "free rotation"
   $: /* Keep the draw operation synced to the modifier keys. */ {
      chosenDrawMode = alt
         ? shift
            ? "free rotation"
            : "snapped rotation"
         : "strafing"
      updateDraw()
   }

   // ---------------------------- Primary events -----------------------------
   function buttonPressed(name: keyof typeof button) {
      // This function abstracts over mouse and keyboard events.
      if ((name === "relax" || name === "freeze") && button.draw.state) {
         chainDraw(name === "freeze")
      } else {
         abortAndReleaseAll()
         button[name] = { state: "pressing", downPosition: mouse }
         if (name === "relax") {
            let segment = closestNearTo(mouse, Segment.s)?.object
            if (segment?.isFrozen) {
               segment.isFrozen = false
               Segment.s = Segment.s
            }
         } else if (name === "freeze") {
            let segment = closestNearTo(mouse, Segment.s)?.object
            if (segment?.isFrozen === false) {
               segment.isFrozen = true
               Segment.s = Segment.s
            }
            // } else if (name === "A" && cmd) {
            //    // Select everything in the circuit.
            //    selected = new ToggleSet()
            //    for (let segment of Segment.s) selected.add(segment)
            //    for (let symbol of SymbolInstance.s) selected.add(symbol)
         } else if (name === "debug") {
            debug = !debug
         }
      }
   }
   function buttonReleased(name: keyof typeof button) {
      if (button[name].state) {
         switch (name) {
            case "draw":
               if (button[name].state === "pressing") {
                  drawButtonTapped()
               } else if (button[name].state === "dragging") {
                  endDraw()
               }
               break
            case "erase":
               endEraseSelect()
               break
            case "relax":
               endRelaxSelect()
               break
            case "slide":
               endSlide()
               break
            case "freeze":
               endFreezeSelect()
               break
         }
         button[name] = { state: null }
      }
   }
   function updateModifierKeys(event: KeyboardEvent | MouseEvent) {
      shift = event.getModifierState("Shift")
      alt = event.getModifierState("Alt")
      cmd = event.getModifierState("Control") || event.getModifierState("Meta")
   }
   $: shift ? shiftDown() : shiftUp()
   $: alt ? altDown() : altUp()
   $: cmd ? cmdDown() : cmdUp()
   function shiftDown() {}
   function shiftUp() {}
   function altDown() {
      if (draw) {
         // Reset the reference information for the movement.
         move.partGrabbed = move.draw.segment.end.clone()
         for (let thing of move.originalPositions.keys()) {
            if (thing instanceof Junction || thing instanceof Port) {
               move.originalPositions.set(thing, thing.clone())
            } else {
               move.originalPositions.set(thing, thing.position.clone())
            }
         }
      }
   }
   function altUp() {}
   function cmdDown() {}
   function cmdUp() {}
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
      updateEraseSelect()
      updateRelaxSelect()
      updateFreezeSelect()
      // Check for the initiation of drag-based operations.
      if (button.draw.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.draw.downPosition)
         if (dragVector.sqLength() >= halfGap * halfGap) {
            button.draw = { ...button.draw, state: "dragging" }
            beginDraw(dragVector)
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
      if (button.relax.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.relax.downPosition)
         if (dragVector.sqLength() >= sqSelectStartDistance) {
            button.relax = { ...button.relax, state: "dragging" }
            beginRelaxSelect(button.relax.downPosition)
         }
      }
      if (button.freeze.state === "pressing") {
         let dragVector = mouse.displacementFrom(button.freeze.downPosition)
         if (dragVector.sqLength() >= sqSelectStartDistance) {
            button.freeze = { ...button.freeze, state: "dragging" }
            beginFreezeSelect(button.freeze.downPosition)
         }
      }
   }
   function spawnSymbol(kind: SymbolKind, grabOffset: Vector, e: MouseEvent) {
      // Update the mouse's state.
      let p = mouseInCoordinateSystemOf(canvas, e)
      button.draw = { state: "dragging", downPosition: p }
      // Spawn a symbol on the canvas, and initiate a slide action.
      let spawnPosition = mouse.displacedBy(grabOffset)
      let symbol = new SymbolInstance(kind, spawnPosition, Rotation.zero)
      selected = new ToggleSet([symbol])
      beginMove("move", { grabbed: symbol, atPart: mouse })
   }

   // ---------------------------- Derived events -----------------------------
   function beginDraw(dragVector: Vector) {
      if (button.draw.state !== "dragging") return
      if (button.draw.downJunction) {
         // Start the draw operation at the endpoint of the previous
         // draw operation.
         let lastDrawAxis = button.draw.downJunction.axes()[0]
         // Determine the axis the draw operation should begin along.
         let drawAxis = findAxis(Axis.fromVector(dragVector) as Axis)
         if (chosenDrawMode === "strafing") {
            drawAxis = nearestAxis(
               drawAxis,
               primaryAxes.filter((axis) => axis !== lastDrawAxis)
            )
         } else if (chosenDrawMode === "snapped rotation") {
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
      let dragAxis = findAxis(Axis.fromVector(dragVector) as Axis)
      let standardAxes =
         chosenDrawMode === "strafing"
            ? primaryAxes
            : chosenDrawMode === "snapped rotation"
            ? snapAxes
            : [dragAxis]
      if (attach?.object instanceof Segment) {
         let segment = attach.object
         let closestPart = attach.closestPart
         let drawAxis =
            chosenDrawMode === "strafing"
               ? nearestAxis(dragAxis, [...standardAxes, segment.axis])
               : chosenDrawMode === "snapped rotation"
               ? nearestAxis(dragAxis, standardAxes)
               : dragAxis
         if (chosenDrawMode !== "free rotation" && drawAxis === segment.axis) {
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
         if (chosenDrawMode !== "free rotation") {
            let considerAxis =
               chosenDrawMode === "strafing"
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
      }
      } else {
      }
      }
      }
   }
   function updateDraw() {
      if (!draw) return
      if (draw.mode !== chosenDrawMode) {
         // Change modes.
         // TODO:

         draw.mode = chosenDrawMode
         draw.shouldEaseIn = false
      }
      if (draw.mode === "snapped rotation") {
         let dragVector = mouse.displacementFrom(draw.segment.start)
         let dragAxis = findAxis(Axis.fromVector(dragVector))
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
            associatedDrawAxis = (vertex: Vertex) => draw!.segment.axis
            defaultDrawAxis = draw.segment.axis
         } else {
            // draw.mode === "free rotation"
            associatedDrawAxis = (vertex: Vertex) =>
               findAxis(
                  Axis.fromVector(vertex.displacementFrom(draw!.segment.start))
               )
            defaultDrawAxis = findAxis(
               Axis.fromVector(mouse.displacementFrom(draw.segment.start))
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
   function chainDraw(freezeCurrent: boolean) {
      if (!draw) return
      draw.segment.isFrozen = freezeCurrent
      // Start a new draw operation at the current draw endpoint.
      draw.endObject = undefined // Don't connect to anything else.
      endDraw(false)
      button.draw = {
         state: "pressing",
         downPosition: mouse,
         downJunction: draw.end,
      }
   }
   function beginSlide(slideAxis: Axis, grabbed: Grabbable, atPart: Point) {
      let orthogonalAxis = findAxis(slideAxis.orthogonal())
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
      function generateInstructions(slideDir: Direction): SlideInstruction[] {
         let instructions: SlideInstruction[] = [] // the final sequence
         let heap = new Heap<SlideInstruction>((a, b) => a.delay - b.delay)
         // Store both preliminary and finalized proposals.
         let proposals = new Map<Movable, SlideInstruction>()
         // Add initial proposals to the heap.
         if (grabbed instanceof Segment) {
            let i1 = { movable: movableAt(grabbed.start), delay: 0 }
            let i2 = { movable: movableAt(grabbed.end), delay: 0 }
            proposals.set(movableAt(grabbed.start), i1)
            proposals.set(movableAt(grabbed.end), i2)
            heap.push(i1)
            heap.push(i2)
         } else {
            let i = { movable: grabbed, delay: 0 }
            proposals.set(grabbed, i)
            heap.push(i)
         }
         while (heap.size() > 0) {
            let nextInstruction = heap.pop() as SlideInstruction
            let { movable, delay } = nextInstruction
            // Schedule this Movable.
            instructions.push(nextInstruction)
            // Push via adjacent segments.
            for (let [segment, adjVertex] of movable.edges()) {
               if (segment === draw?.segment) continue
               let nearVertex =
                  adjVertex === segment.end ? segment.start : segment.end
               let adjDirection = adjVertex.directionFrom(nearVertex)
               if (!adjDirection) continue
               let adjDelay = delay
               if (!segment.isFrozen) {
                  if (adjDirection.approxEquals(slideDir, 0.1)) {
                     // Allow the edge to contract to a length of standardGap.
                     adjDelay += Math.max(0, segment.length() - standardGap)
                  } else if (segment.axis === slideAxis) {
                     // The segment can stretch indefinitely.
                     continue
                  }
               }
               let adjMovable = movableAt(adjVertex)
               let adjProposal = proposals.get(adjMovable)
               if (adjProposal) {
                  if (adjProposal.delay > adjDelay) {
                     // We've found something that will push the adjacent
                     // Movable *sooner*. Decrease its delay.
                     adjProposal.delay = delay
                     heap.updateItem(adjProposal)
                  }
               } else {
                  // Add an initial proposal to the heap.
                  let proposal = { movable: adjMovable, delay: adjDelay }
                  proposals.set(adjMovable, proposal)
                  heap.push(proposal)
               }
               if (segment.axis === orthogonalAxis) {
               }
            }
         }
         return instructions
      }
      slide = {
         originalPositions,
         partGrabbed: atPart.clone(),
         axis: slideAxis,
         posInstructions: generateInstructions(slideAxis.posDirection()),
         negInstructions: generateInstructions(slideAxis.negDirection()),
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
         // Move enough to "straighten out" the line being drawn.
         let [slideVector] = draw.end
            .displacementFrom(draw.segment.start)
            .inTermsOfBasis([slide.axis, draw.segment.axis])
         slideDistance = slideVector.scalarProjectionOnto(slide.axis)
         shouldSnap = false
      } else {
         // The slideDistance will be determined by updateSlide().
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
         instructions = slide.posInstructions
      } else {
         direction = slide.axis.negDirection()
         instructions = slide.negInstructions
         slideDistance = -slideDistance
      }
      // TODO: Do a pre-pass through the instruction set, and if the movement
      // is *close* to pushing the next object, increase the slideDistance so
      // that it does. (Note: this must be done BEFORE the main movement loop.)

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
   function beginEraseSelect(start: Point) {
      eraseSelect = { start, items: new Set() }
   }
   function beginRelaxSelect(start: Point) {
      relaxSelect = { start, items: new Set() }
   }
   function beginFreezeSelect(start: Point) {
      freezeSelect = { start, items: new Set() }
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
   function updateRelaxSelect() {
      if (!relaxSelect) return
      relaxSelect.items = new Set()
      let range = Range2D.fromCorners(relaxSelect.start, mouse)
      for (let segment of Segment.s)
         if (range.intersects(segment)) relaxSelect.items.add(segment)
   }
   function updateFreezeSelect() {
      if (!freezeSelect) return
      freezeSelect.items = new Set()
      let range = Range2D.fromCorners(freezeSelect.start, mouse)
      for (let segment of Segment.s)
         if (range.intersects(segment)) freezeSelect.items.add(segment)
   }
   function endEraseSelect() {
      if (!eraseSelect) return
      deleteItems(eraseSelect.items)
      eraseSelect = null
   }
   function endRelaxSelect() {
      if (!relaxSelect) return
      for (let item of relaxSelect.items) item.isFrozen = false
      Segment.s = Segment.s
      relaxSelect = null
   }
   function endFreezeSelect() {
      if (!freezeSelect) return
      for (let item of freezeSelect.items) item.isFrozen = true
      Segment.s = Segment.s
      freezeSelect = null
   }
   function abortEraseSelect() {
      eraseSelect = null
   }
   function abortRelaxSelect() {
      relaxSelect = null
   }
   function abortFreezeSelect() {
      freezeSelect = null
   }
   function abortAndReleaseAll() {
      abortDraw()
      abortSlide()
      abortEraseSelect()
      abortRelaxSelect()
      abortFreezeSelect()
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
         buttonReleased(buttonMap.LMB)
         lmbShouldBeDown = false
      }
      if (!rightMouseIsDown(event) && rmbShouldBeDown) {
         buttonReleased(buttonMap.RMB)
         rmbShouldBeDown = false
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
                  isFrozen={(segment.isFrozen &&
                     !relaxSelect?.items.has(segment)) ||
                     freezeSelect?.items.has(segment)}
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
               isFrozen={(glyph.segment.isFrozen &&
                  !relaxSelect?.items.has(glyph.segment)) ||
                  freezeSelect?.items.has(glyph.segment)}
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
      {#if relaxSelect}
         <RectSelectBox start={relaxSelect.start} end={mouse} />
      {/if}
      {#if freezeSelect}
         <RectSelectBox start={freezeSelect.start} end={mouse} />
      {/if}
      <!-- Tool bar -->
      <ToolButton
         label="Query"
         x={0 * toolButtonSize}
         y={canvasHeight - 2 * toolButtonSize}
         size={toolButtonSize}
         active={button.query.state !== null}
      />
      <ToolButton
         label="Weave"
         x={1 * toolButtonSize}
         y={canvasHeight - 2 * toolButtonSize}
         size={toolButtonSize}
         active={button.weave.state !== null}
      />
      <ToolButton
         label="Erase"
         x={2 * toolButtonSize}
         y={canvasHeight - 2 * toolButtonSize}
         size={toolButtonSize}
         active={button.erase.state !== null}
      />
      <ToolButton
         label="Relax"
         x={3 * toolButtonSize}
         y={canvasHeight - 2 * toolButtonSize}
         size={toolButtonSize}
         active={button.relax.state !== null}
      />
      <ToolButton
         label="Tether"
         x={4 * toolButtonSize}
         y={canvasHeight - 2 * toolButtonSize}
         size={toolButtonSize}
         active={button.tether.state !== null}
      />
      <ToolButton
         label="Adjust"
         x={0 * toolButtonSize}
         y={canvasHeight - toolButtonSize}
         size={toolButtonSize}
         active={button.operationA.state !== null}
      />
      <ToolButton
         label="Slide"
         x={1 * toolButtonSize}
         y={canvasHeight - toolButtonSize}
         size={toolButtonSize}
         active={button.slide.state !== null}
      />
      <ToolButton
         label="Draw"
         x={2 * toolButtonSize}
         y={canvasHeight - toolButtonSize}
         size={toolButtonSize}
         active={button.draw.state !== null}
      />
      <ToolButton
         label="Freeze"
         x={3 * toolButtonSize}
         y={canvasHeight - toolButtonSize}
         size={toolButtonSize}
         active={button.freeze.state !== null}
      />
      <ToolButton
         label="G"
         x={4 * toolButtonSize}
         y={canvasHeight - toolButtonSize}
         size={toolButtonSize}
         active={button.operationG.state !== null}
      />
   </g>
</svg>

<style>
   svg {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
   }
</style>
