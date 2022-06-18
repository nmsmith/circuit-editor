<script lang="ts" context="module">
   // ------------------------- Exported definitions --------------------------
   export type Tool = "select & move" | "draw"
   export type LineType = "hydraulic" | "pilot" | "drain"
</script>

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

   // ---------------------- Props (for input & output) -----------------------
   // Props that must be bound by the parent component.
   export let shift: boolean
   export let alt: boolean
   export let cmd: boolean
   export let onSymbolLeave: (
      kind: SymbolKind,
      grabOffset: Vector,
      event: MouseEvent
   ) => void
   // Values shared with the parent component.
   export const onToolChanged = toolChanged
   export const onNextLineType = nextLineType
   export const onDelete = deleteSelected
   export const onSymbolEnter = spawnSymbol
   // Events triggered by updates to props.
   $: shift ? shiftDown() : shiftUp()
   $: alt ? altDown() : altUp()
   $: cmd ? cmdDown() : cmdUp()

   // ------------------------------ Constants --------------------------------
   let canvas: SVGElement // the root element of this component
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   // Configurable constants
   const sqMinSegmentLength = 15 * 15
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
   // The default axes used for snapping.
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
   function* vertices(): Generator<Vertex> {
      for (let v of Junction.s) yield v
      for (let v of Port.s) yield v
   }
   function* attachableVertices(): Generator<Vertex> {
      for (let v of Junction.s) yield v
      for (let v of Port.s) if (!v.edge) yield v
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
      return (
         closestNearTo(point, attachableVertices()) ||
         closestNearTo(point, Segment.s)
      )
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
   type HighlightStyle = "hover" | "select" | undefined
   function styleOf(thing: Highlightable | Selectable): HighlightStyle {
      if (selected.has(thing as Selectable)) return "select"
      if (highlighted.has(thing)) return "hover"
   }
   function layerOf(point: Point): "lower" | "upper" {
      return point instanceof Port || point === move?.draw?.segment.end
         ? "upper"
         : "lower"
   }
   function shouldExtendTheLineAt(
      vertex: Vertex,
      drawAxis: Axis
   ): vertex is Junction {
      return (
         vertex instanceof Junction &&
         vertex.axes().length === 1 &&
         vertex.axes()[0] === drawAxis &&
         !alt
      )
   }

   // ---------------------------- Primary state ------------------------------
   // Note: This is the state of the editor. The circuit is stored elsewhere.
   let mouse: { position: Point } & (
      | { state: "up" }
      // Pressing, but not yet moved enough to constitute a drag.
      | { state: "pressing"; downPosition: Point }
      | { state: "dragging"; downPosition: Point }
   ) = { position: Point.zero, state: "up" }
   let tool: Tool = "draw"
   let move: null | {
      movables: Set<Movable>
      axisGrabbed: Axis
      partGrabbed: Point
      distance: number
      originalPositions: DefaultMap<Movable, Point>
      draw?: {
         segment: Segment
         segmentIsNew: boolean
         endObject?: Attachable
      }
   } = null
   let rectSelect: null | Set<Selectable> = null
   let selected: ToggleSet<Selectable> = new ToggleSet()

   // ---------------------------- Derived state ------------------------------
   let drawMode:
      | undefined
      | "strafing"
      | "fixed-axis rotation"
      | "free rotation"
   $: {
      if (move && move.draw) {
         drawMode = alt
            ? shift
               ? "free rotation"
               : "fixed-axis rotation"
            : "strafing"
      } else {
         drawMode = undefined
      }
      updateMove() // Treat changes to drawMode as events.
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
   $: /* Where helpful, change the appearance of the mouse cursor. */ {
      if (tool === "draw") {
         cursor = "cell"
      } else if (move) {
         cursor = "grabbing"
      } else {
         cursor = "default"
         let grab = closestGrabbable(mouse.position)
         if (tool === "select & move" && grab && !shift && !alt && !cmd) {
            cursor = mouse.state === "pressing" ? "grabbing" : "grab"
         }
      }
   }
   let highlighted: Set<Highlightable>
   $: /* Highlight objects near the mouse cursor. */ {
      highlighted = new Set()
      if (move?.draw?.endObject instanceof Segment) {
         highlighted.add(move.draw.endObject)
      } else if (rectSelect) {
         highlighted = new Set(rectSelect)
      } else if (gapHighlighted.size > 0) {
         for (let s of gapHighlighted) highlighted.add(s)
      } else if (tool === "select & move" && !move) {
         let grab = closestGrabbable(mouse.position)
         if (grab) highlighted.add(grab.object)
      } else if (tool === "draw" && !move) {
         let thing = closestAttachableOrToggleable(mouse.position)
         if (thing) {
            if (thing.object instanceof Crossing) {
               highlighted.add(thing.closestPart)
            } else {
               highlighted.add(thing.object)
            }
         }
      }
   }
   let gapHighlighted: Set<Segment>
   $: /* When activated, highlight all objects which are standardGap apart.*/ {
      if (tool === "select & move" && !move && cmd) {
         gapHighlighted = new Set()
         let s = closestNearTo(mouse.position, Segment.s)
         if (s) {
            // Do gap highlighting (and later, selection) along the axis
            // orthogonal to the segment's axis. To achieve this, we
            // re-coordinatize every object that has the same orientation as
            // the segment as an AABB, and search along the resultant y-axis.
            let selectAxis = s.object.axis
            let orthAxis = findAxis(selectAxis.orthogonal())
            type SegmentInfo = {
               segment: Segment
               x: number[]
               y: number[]
               visited: boolean
            }
            let info = new Map<Segment, SegmentInfo>()
            for (let seg of Segment.s) {
               if (seg.axis !== selectAxis && seg.axis !== orthAxis) continue
               let start = seg.start.relativeTo(selectAxis)
               let end = seg.end.relativeTo(selectAxis)
               let x = start.x <= end.x ? [start.x, end.x] : [end.x, start.x]
               let y = start.y <= end.y ? [start.y, end.y] : [end.y, start.y]
               info.set(seg, { segment: seg, x, y, visited: false })
            }
            let [front, back] =
               s.closestPart
                  .displacementFrom(mouse.position)
                  .relativeTo(selectAxis).y > 0
                  ? [0, 1]
                  : [1, 0]
            gapHighlighted.add(s.object)
            let startInfo = info.get(s.object) as SegmentInfo
            startInfo.visited = true
            highlightFrom(startInfo)
            function highlightFrom(current: SegmentInfo) {
               for (let i of info.values()) {
                  if (i.visited) continue
                  let disp = (back - front) * (i.y[front] - current.y[back])
                  if (
                     // If the bounding boxes are touching...
                     Math.abs(disp - standardGap) < gapSelectError &&
                     i.x[0] <= current.x[1] + standardGap &&
                     i.x[1] >= current.x[0] - standardGap
                  ) {
                     gapHighlighted.add(i.segment)
                     i.visited = true
                     highlightFrom(i)
                  }
               }
            }
         }
      } else {
         gapHighlighted = new Set()
      }
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
            if (v.edges.size > 2) {
               glyphsToDraw.add({
                  type: "junction node",
                  junction: v,
                  style: styleOf(v),
               })
            } else if (
               v.isStraightLine() ||
               highlighted.has(v) ||
               selected.has(v)
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
   }
   // This function would _ideally_ be encoded as derived state (using $:),
   // but unfortunately it is needed _sooner_ than Svelte can compute it.
   function selectedMovables(): Set<Movable> {
      let s = new Set<Movable>()
      for (let g of selected) {
         if (isMovable(g)) {
            s.add(g)
         } else {
            s.add(isMovable(g.start) ? g.start : g.start.symbol)
            s.add(isMovable(g.end) ? g.end : g.end.symbol)
         }
      }
      return s
   }

   // ---------------------------- Primary events -----------------------------
   function toolChanged(newTool: Tool) {
      tool = newTool
      if (tool === "draw" && !move) selected = new ToggleSet()
   }
   function nextLineType() {
      // TODO — toggle through line types.
   }
   function deleteSelected() {
      let junctionsToConvert = new Set<Junction>()
      for (let thing of selected) {
         if (thing instanceof Port) continue // Ports are not deletable.
         thing.delete().forEach((neighbor) => junctionsToConvert.add(neighbor))
      }
      for (let junction of junctionsToConvert) {
         if (junction.edges.size === 2) junction.convertToCrossing(crossingMap)
      }
      selected = new ToggleSet()
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function spawnSymbol(kind: SymbolKind, grabOffset: Vector, e: MouseEvent) {
      mouse.position = mouseInCoordinateSystemOf(canvas, e)
      let spawnPosition = mouse.position.displacedBy(grabOffset)
      let symbol = new SymbolInstance(kind, spawnPosition, Rotation.zero)
      selected = new ToggleSet([symbol])
      beginMove("move", { grabbed: symbol, atPart: mouse.position })
   }
   function shiftDown() {}
   function shiftUp() {}
   function altDown() {
      if (move?.draw) {
         // Reset the reference information for the movement.
         move.partGrabbed = move.draw.segment.end.clone()
         for (let movable of move.originalPositions.keys()) {
            if (movable instanceof Junction) {
               move.originalPositions.set(movable, movable.clone())
            } else {
               move.originalPositions.set(movable, movable.position.clone())
            }
         }
      }
   }
   function altUp() {}
   function cmdDown() {}
   function cmdUp() {}
   let waitedOneFrame = false
   function leftMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b1) === 1
   }
   function leftMouseDown() {
      let grab = closestGrabbable(mouse.position)
      if (tool === "select & move" && grab && !shift && !alt) {
         // Immediately treat the operation as a drag.
         mouse = { ...mouse, state: "dragging", downPosition: mouse.position }
         if (cmd) {
            selected.clear()
            for (let s of gapHighlighted) selected.add(s)
         } else if (!selected.has(grab.object)) {
            selected = new ToggleSet([grab.object])
         }
         beginMove("move", {
            grabbed: grab.object,
            atPart: grab.closestPart,
         })
      } else {
         mouse = { ...mouse, state: "pressing", downPosition: mouse.position }
      }
   }
   function mouseMoved(previousMousePosition: Point) {
      if (move)
         move.distance += mouse.position.distanceFrom(previousMousePosition)
      // Update the actions that depend on mouse movement. (It's important that
      // these updates are invoked BEFORE any begin___() functions. The begin___
      // funcs may induce changes to derived data that the updates need to see.)
      if (move) updateMove()
      if (rectSelect) updateRectSelect()
      if (mouse.state === "pressing") {
         // Check if the mouse has moved enough to constitute a drag.
         let dragVector = mouse.position.displacementFrom(mouse.downPosition)
         let sqLengthRequiredForDragStart = {
            "select & move": 4 * 4,
            draw: sqSnapRadius, // a larger value helps us deduce draw direction
         }
         if (dragVector.sqLength() >= sqLengthRequiredForDragStart[tool]) {
            mouse = { ...mouse, state: "dragging" }
            switch (tool) {
               case "select & move":
                  beginRectSelect(mouse.downPosition)
                  break
               case "draw": {
                  let c = closestAttachableOrToggleable(mouse.downPosition)
                  // Disallow the initiation of a draw operation at a crossing.
                  if (c?.object instanceof Crossing) break
                  let drawAxis =
                     Math.abs(dragVector.x) >= Math.abs(dragVector.y)
                        ? Axis.horizontal
                        : Axis.vertical
                  let attach = closestAttachable(mouse.downPosition)
                  if (attach) {
                     if (attach.object instanceof Segment) {
                        let cutPoint = new Junction(attach.closestPart)
                        attach.object.cutAt(cutPoint)
                        beginMove("draw", { start: cutPoint, axis: drawAxis })
                     } else if (
                        shouldExtendTheLineAt(attach.object, drawAxis)
                     ) {
                        // Extend the current line, to match the user's
                        // probable intent.
                        selected = new ToggleSet([attach.object])
                        beginMove("move", {
                           grabbed: attach.object,
                           atPart: attach.object,
                        })
                     } else {
                        beginMove("draw", {
                           start: attach.object,
                           axis: drawAxis,
                        })
                     }
                  } else
                     beginMove("draw", {
                        start: new Junction(mouse.downPosition),
                        axis: drawAxis,
                     })
                  break
               }
            }
         }
      }
   }
   function leftMousePressEnded(unexpectedly: true) {
      mouse = { ...mouse, state: "up" }
   }
   function leftMouseDragEnded(unexpectedly: boolean = false) {
      if (move) endMove()
      if (rectSelect) endRectSelect()
      mouse = { ...mouse, state: "up" }
   }
   function leftMouseClicked() {
      switch (tool) {
         case "select & move": {
            let grab = closestGrabbable(mouse.position)
            if (!grab) selected.clear()
            else if (shift && cmd) for (let s of gapHighlighted) selected.add(s)
            else if (shift && !cmd) selected.toggle(grab.object)
            else if (alt && cmd)
               for (let s of gapHighlighted) selected.delete(s)
            else if (alt && !cmd) selected.delete(grab.object)
            else selected = new ToggleSet([grab.object])
            selected = selected
            break
         }
         case "draw": {
            let toggle = closestToggleable(mouse.position)
            if (!toggle) break
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
               toggle.object.cutAt(cutPoint)
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
            break
         }
      }
   }

   // ---------------------------- Derived events -----------------------------
   type DrawInfo = { start: Vertex; axis: Axis }
   type MoveInfo = { grabbed: Grabbable; atPart: Point }
   function beginMove(type: "draw", info: DrawInfo): void
   function beginMove(type: "move", info: MoveInfo): void
   function beginMove(type: "draw" | "move", info: DrawInfo | MoveInfo) {
      let draw
      let partGrabbed
      // For the time being, I am hard-coding the 30px snapping to only occur
      // amongst circuit elements that are oriented horizontally and vertically.
      // If the code below is commented out, then snapping will occur amongst
      // elements whose axis is the same as the element being grabbed.
      let axisGrabbed = Axis.horizontal
      if (type === "draw") {
         info = info as DrawInfo // hack to tell TypeScript the correct type
         // Add the line being drawn to the circuit.
         let end = new Junction(info.start)
         selected = new ToggleSet([end]) // enables the endpoint to be dragged
         let segment = new Segment(info.start, end, info.axis)
         draw = { segment, segmentIsNew: true }
         partGrabbed = end.clone()
         //axisGrabbed = info.axis
      } else {
         info = info as MoveInfo // hack to tell TypeScript the correct type
         partGrabbed = info.atPart.clone()
         // Find the Axis that moved objects should snap along & orthogonal to.
         // if (info.grabbed instanceof Segment) {
         //    axisGrabbed = info.grabbed.axis
         // } else if (info.grabbed instanceof SymbolInstance) {
         //    axisGrabbed = findAxis(Axis.fromDirection(info.grabbed.direction()))
         // } else {
         //    let _
         //    let axis = Axis.horizontal
         //    for ([{ axis }] of info.grabbed.edges) {
         //       // Prefer horizontal and vertical axes.
         //       if (axis === Axis.horizontal || axis === Axis.vertical) break
         //    }
         //    axisGrabbed = axis
         // }
      }
      // Before movement commences, record the position of every Movable.
      // We need to use the original positions as a reference, because we will
      // be mutating them over the course of the movement.
      let originalPositions = new DefaultMap<Movable, Point>(() => Point.zero)
      for (let junction of Junction.s) {
         originalPositions.set(junction, junction.clone())
      }
      for (let symbol of SymbolInstance.s) {
         originalPositions.set(symbol, symbol.position.clone())
      }
      let selectedMovables_ = selectedMovables()
      // If moving a Junction with only one edge, treat the move as a draw.
      if (!draw && selectedMovables_.size === 1) {
         let end
         for (end of selectedMovables_) {
         }
         if (end instanceof Junction && end.edges.size === 1) {
            let existingSegment, start
            for ([existingSegment, start] of end.edges) {
            }
            existingSegment = existingSegment as Segment
            start = start as Vertex
            // The existing segment may be "backwards". We need to replace
            // it with a segment whose .end is the vertex being grabbed.
            let segment = new Segment(start, end, existingSegment.axis)
            existingSegment.replaceWith(segment)
            draw = { segment, segmentIsNew: false }
         }
      }
      move = {
         movables: selectedMovables_,
         axisGrabbed,
         partGrabbed,
         distance: 0,
         originalPositions,
         draw,
      }
   }
   function updateMove() {
      if (!move || mouse.state === "up") return
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s

      let draw = move.draw
      if (draw && drawMode === "fixed-axis rotation") {
         // Check which axis the mouse is closest to. If the axis has
         // changed, restart the move operation along the new axis.
         let drawVector = mouse.position.displacementFrom(draw.segment.start)
         let newAxis = findAxis(Axis.fromVector(drawVector))
         if (newAxis) {
            // Snap to the nearest standard axis.
            let scores = snapAxes.map((axis) =>
               Math.abs((newAxis as Axis).dot(axis))
            )
            newAxis = snapAxes[scores.indexOf(Math.max(...scores))]
            if (newAxis !== draw.segment.axis) {
               let newEnd = draw.segment.start.displacedBy(
                  drawVector.projectionOnto(newAxis)
               )
               ;(draw.segment.end as Junction).moveTo(newEnd)
               ;(draw.segment.axis as Axis) = newAxis
               // Reset the move operation.
               beginMove("move", {
                  grabbed: draw.segment.end as Junction,
                  atPart: draw.segment.end,
               })
               draw = move.draw
            }
         }
      } else if (draw && drawMode === "free rotation") {
         // To accommodate for the constantly-changing drawing axis,
         // the move operation is restarted from scratch every update.
         function isAcceptableTEMP(vertex: Vertex) {
            if (vertex === draw!.segment.end) return false
            if (vertex instanceof Port) return true
            let start = draw!.segment.start
            let drawAxis = findAxis(
               Axis.fromVector(vertex.displacementFrom(start))
            )
            if (!drawAxis) return false
            for (let [{ axis }, other] of vertex.edges) {
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
         let closest = closestNearTo(
            mouse.position,
            Array.from(attachableVertices()).filter(isAcceptableTEMP)
         )
         let newAxis = findAxis(
            Axis.fromVector(
               closest
                  ? closest.object.displacementFrom(draw.segment.start)
                  : mouse.position.displacementFrom(draw.segment.start)
            )
         )
         if (newAxis) {
            let newEnd = closest ? closest.object : mouse.position
            ;(draw.segment.end as Junction).moveTo(newEnd)
            ;(draw.segment.axis as Axis) = newAxis
            // Reset the move operation.
            beginMove("move", {
               grabbed: draw.segment.end as Junction,
               atPart: draw.segment.end,
            })
            draw = move.draw
            if (draw /* This should always be true. */) {
               // Do snapping.
               if (closest) {
                  draw.endObject = closest.object
               } else {
                  let s = closestSegmentNearTo(mouse.position, newAxis)
                  if (s) {
                     ;(draw.segment.end as Junction).moveTo(s.closestPart)
                     draw.endObject = s.object
                  } else {
                     draw.endObject = undefined
                  }
               }
            } else console.warn("move.draw was unexpectedly null.")
         }
      }
      if (draw && drawMode === "free rotation") return
      let drawingSpecialCase = draw && draw.segment.start.axes().length !== 2
      type Movement = {
         vector: Vector
      } & (
         | { type: "no move" }
         | { type: "full move" }
         | { type: "axis move"; moveAxis: Axis; absorbAxis: Axis }
      )
      // This is a "global variable" throughout the forthcoming operations.
      let movements = new DefaultMap<Movable, Movement>(() => {
         return { type: "no move", vector: zeroVector }
      })
      let fullMove
      if (
         move.distance < 15 &&
         (!draw || (drawMode === "strafing" && !draw.segmentIsNew))
      ) {
         // The user may have grabbed slightly-away from their target object.
         // If so, gradually pull the object towards the mouse cursor.
         fullMove = mouse.position.displacementFrom(
            mouse.downPosition.interpolatedToward(
               move.partGrabbed,
               move.distance / 15
            )
         )
      } else {
         fullMove = mouse.position.displacementFrom(move.partGrabbed)
      }
      // Firstly, perform a simple movement that tracks the mouse.
      if (draw && drawMode === "fixed-axis rotation") {
         fullMove = fullMove.projectionOnto(draw.segment.axis)
         moveOne(draw.segment.end as Junction, fullMove)
      } else {
         moveSelected(fullMove)
      }
      let snappedToPoint = false
      if (draw && drawMode === "strafing") {
         // Try snapping the moved endpoint to another endpoint nearby.
         function isAcceptableTEMP(vertex: Vertex) {
            if (vertex instanceof Port) return true
            if (movements.read(vertex).type !== "no move") return false
            let start = draw!.segment.start
            for (let [{ axis }, other] of vertex.edges) {
               // Reject if the segment being drawn would overlap this seg.
               if (
                  axis === draw!.segment.axis &&
                  other.distanceFrom(start) + 1 <
                     vertex.distanceFrom(start) + other.distanceFrom(vertex)
               )
                  return false
            }
            return true
         }
         let closest = closestNearTo(
            draw.segment.end,
            Array.from(attachableVertices()).filter(isAcceptableTEMP)
         )
         if (closest) {
            snappedToPoint = true
            let snappedMove = closest.object.displacementFrom(move.partGrabbed)
            moveSelected(snappedMove)
            draw.endObject = closest.object
         } else {
            draw.endObject = undefined
         }
      }
      if (!snappedToPoint) {
         // Snap axis-aligned objects to a "standardGap" distance apart.
         let snappedMove =
            move.distance === 0
               ? fullMove
               : fullMove.add(computeStandardGapEase())
         if (draw && drawMode === "fixed-axis rotation") {
            snappedMove = snappedMove.projectionOnto(draw.segment.axis)
            moveOne(draw.segment.end as Junction, snappedMove)
         } else {
            moveSelected(snappedMove)
         }
         if (draw) {
            // Try snapping the endpoint to nearby segments.
            let s = closestSegmentNearTo(draw.segment.end, draw.segment.axis)
            if (s) {
               ;(draw.segment.end as Junction).moveTo(s.closestPart)
               draw.endObject = s.object
            } else {
               draw.endObject = undefined
            }
         }
      }

      function movableAt(vertex: Vertex): Movable {
         return vertex instanceof Junction ? vertex : vertex.symbol
      }
      function moveOne(m: Movable, vector: Vector) {
         movements.set(m, { type: "full move", vector })
         m.moveTo(move!.originalPositions.read(m).displacedBy(vector))
      }
      function moveSelected(vector: Vector) {
         // Compute the movement of every Movable in the circuit.
         movements.clear()
         if (draw) {
            let segment = draw.segment
            function specialMove() {
               movements.set(segment.end as Junction, {
                  type: "full move",
                  vector,
               })
               let remainingMove = vector.rejectionFrom(segment.axis)
               propagateMovement(remainingMove, movableAt(segment.start))
            }
            if (drawingSpecialCase) {
               specialMove()
            } else {
               // Try a normal move.
               for (let movable of move!.movables) {
                  propagateMovement(vector, movable)
               }
               // If we weren't able to alter the length of the segment being
               // drawn, resort to a special move.
               if (
                  movements.read(movableAt(segment.start)).type === "full move"
               ) {
                  movements.clear()
                  specialMove()
               }
            }
         } else {
            // Do a normal move.
            for (let movable of move!.movables) {
               propagateMovement(vector, movable)
            }
         }
         // Update the position of each Movable.
         for (let movable of movables()) {
            movable.moveTo(
               move!.originalPositions
                  .read(movable)
                  .displacedBy(movements.read(movable).vector)
            )
         }
      }
      function propagateMovement(
         moveVector: Vector, // The movement being propagated.
         currentMovable: Movable, // The thing we are moving.
         absorbAxis?: Axis // The axis of the edge we just followed (if any).
      ) {
         let current = movements.getOrCreate(currentMovable)
         let axes = currentMovable.axes()
         if (axes.length <= 2 && current.type === "no move" && absorbAxis) {
            // Keep only one component of the movement vector. This allows
            // parts of the circuit to stretch and contract as it is moved.
            let moveAxis
            if (axes.length === 2) {
               moveAxis = absorbAxis === axes[0] ? axes[1] : axes[0]
            } else {
               moveAxis = findAxis(absorbAxis.orthogonal())
            }
            // This is (part of) the formula for expressing a vector in
            // terms of a new basis. We express moveVector in terms of
            // (absorbAxis, moveAxis), but we only keep the 2nd component.
            let vector = moveAxis.scaledBy(
               (absorbAxis.x * moveVector.y - absorbAxis.y * moveVector.x) /
                  (absorbAxis.x * moveAxis.y - absorbAxis.y * moveAxis.x)
            )
            current = { type: "axis move", moveAxis, absorbAxis, vector }
            movements.set(currentMovable, current)
         } else {
            // Movement rigidly.
            current.type = "full move"
            current.vector = moveVector
         }
         let nextEdges =
            currentMovable instanceof Junction
               ? currentMovable.edges
               : currentMovable.ports.flatMap((p) => (p.edge ? [p.edge] : []))
         for (let [nextSegment, nextVertex] of nextEdges) {
            let nextAxis = nextSegment.axis
            let nextMovable = movableAt(nextVertex)
            let next = movements.getOrCreate(nextMovable)
            let loneEdge =
               nextMovable instanceof Junction && nextMovable.edges.size === 1
            if (loneEdge && next.type !== "full move") {
               movements.set(nextMovable, current)
            } else if (
               next.type === "full move" ||
               (next.type === "axis move" && next.absorbAxis === nextAxis)
            ) {
               continue
            } else if (
               current.type === "full move" ||
               (current.type === "axis move" && current.absorbAxis === nextAxis)
            ) {
               propagateMovement(moveVector, nextMovable, nextAxis)
            }
         }
      }
      function computeStandardGapEase(): Vector {
         // The two axes along which this algorithm operates:
         let easeAxes = {
            x: move!.axisGrabbed,
            y: findAxis(move!.axisGrabbed.orthogonal()),
         }
         // Logic for the drawing edge case.
         let drawAxis: "x" | "y" | undefined
         let drawEndSide: "low" | "high" | undefined
         let shouldEase = { x: true, y: true }
         if (draw && drawingSpecialCase) {
            let start = draw.segment.start.relativeTo(easeAxes.x)
            let end = draw.segment.end.relativeTo(easeAxes.x)
            if (draw.segment.axis === easeAxes.x) {
               drawAxis = "x"
               drawEndSide = end.x < start.x ? "low" : "high"
            } else if (draw.segment.axis === easeAxes.y) {
               drawAxis = "y"
               drawEndSide = end.y < start.y ? "low" : "high"
            } else return zeroVector
            shouldEase = { x: drawAxis !== "x", y: drawAxis !== "y" }
         }
         // Output: Whether the Movable can freely move along the given axis.
         function moves(axis: "x" | "y", movable: Movable): boolean {
            let movement = movements.read(movable)
            return (
               movement.type === "full move" ||
               (movement.type === "axis move" &&
                  (movement.moveAxis === easeAxes[axis] ||
                     findAxis(movement.absorbAxis.orthogonal()) ===
                        easeAxes[axis]))
            )
         }
         type SideType = "symbol" | "port" | "junction" | "flank"
         type SideInfo = { type: SideType; value: number; moves: boolean }
         type AxisInfo = { low: SideInfo; high: SideInfo }
         type BoxInfo = { x: AxisInfo; y: AxisInfo }
         // Input: The two opposing corners of an object's bounding box, and
         // the movement info associated with each corner.
         // Output: The position of each side of the box along the two easeAxes,
         // and the manner in which the side can/should move along that axis.
         function boxInfo(thing: Snappable): BoxInfo {
            let a: Point, axType: SideType, ayType: SideType, moveA: Movable
            let b: Point, bxType: SideType, byType: SideType, moveB: Movable
            if (thing instanceof SymbolInstance) {
               let corners = thing.corners()
               a = corners[0].relativeTo(easeAxes.x)
               b = corners[2].relativeTo(easeAxes.x)
               ;[axType, ayType, moveA] = ["symbol", "symbol", thing]
               ;[bxType, byType, moveB] = ["symbol", "symbol", thing]
            } else {
               a = thing.start.relativeTo(easeAxes.x)
               b = thing.end.relativeTo(easeAxes.x)
               axType = ayType =
                  thing.start instanceof Port ? "port" : "junction"
               bxType = byType = thing.end instanceof Port ? "port" : "junction"
               if (a.x === b.x) axType = bxType = "flank"
               if (a.y === b.y) ayType = byType = "flank"
               ;[moveA, moveB] = [movableAt(thing.start), movableAt(thing.end)]
            }
            let axSide = { type: axType, value: a.x, moves: moves("x", moveA) }
            let aySide = { type: ayType, value: a.y, moves: moves("y", moveA) }
            let bxSide = { type: bxType, value: b.x, moves: moves("x", moveB) }
            let bySide = { type: byType, value: b.y, moves: moves("y", moveB) }
            let x =
               a.x <= b.x
                  ? { low: axSide, high: bxSide }
                  : { low: bxSide, high: axSide }
            let y =
               a.y <= b.y
                  ? { low: aySide, high: bySide }
                  : { low: bySide, high: aySide }
            return { x, y }
         }
         // Compute the BoxInfo of each relevant Snappable.
         type Snappable = SymbolInstance | Segment
         let snappables = new Map<Snappable, BoxInfo>()
         for (let symbol of SymbolInstance.s) {
            let axis = findAxis(Axis.fromDirection(symbol.direction()))
            if (axis === easeAxes.x || axis === easeAxes.y)
               snappables.set(symbol, boxInfo(symbol))
         }
         for (let segment of Segment.s) {
            if (segment.axis === easeAxes.x || segment.axis === easeAxes.y)
               snappables.set(segment, boxInfo(segment))
         }
         // Using the details computed above, find the Snappables that are the
         // closest to being "standardGap" apart in each of the axial directions
         type S = Set<[Snappable, Snappable]>
         let minDisp = { x: Infinity, y: Infinity }
         let closestPairs: { x: S; y: S } = { x: new Set(), y: new Set() }
         for (let [thingA, a] of snappables) {
            for (let [thingB, b] of snappables) {
               if (thingA === thingB) continue
               considerAxis("x")
               considerAxis("y")
               function considerAxis(axis: "x" | "y") {
                  let other: "x" | "y" = axis === "x" ? "y" : "x"
                  if (
                     // Are the bounding boxes overlapping along the other axis?
                     a[other].low.value <= b[other].high.value + standardGap &&
                     a[other].high.value >= b[other].low.value - standardGap
                  ) {
                     // Check if thingA can ease towards thingB along this axis.
                     considerSides(axis, "low", "high", true)
                     considerSides(axis, "high", "low", false)
                     if (a[axis].low.type === "junction")
                        considerSides(axis, "low", "low", false)
                     if (b[axis].low.type === "junction")
                        considerSides(axis, "low", "low", true)
                     if (a[axis].high.type === "junction")
                        considerSides(axis, "high", "high", true)
                     if (b[axis].high.type === "junction")
                        considerSides(axis, "high", "high", false)
                  }
               }
               function considerSides(
                  axis: "x" | "y",
                  aSide: "low" | "high",
                  bSide: "low" | "high",
                  flip: boolean
               ) {
                  let condition1 =
                     shouldEase[axis] &&
                     a[axis][aSide].moves &&
                     !b[axis][bSide].moves &&
                     a[axis][aSide].type !== "port" &&
                     b[axis][bSide].type !== "port"
                  let condition2 =
                     thingA === draw?.segment &&
                     a[axis][aSide].type === "junction" &&
                     aSide === drawEndSide
                  if (condition1 || condition2) {
                     let displace = b[axis][bSide].value - a[axis][aSide].value
                     if (flip) {
                        displace += standardGap
                     } else {
                        displace -= standardGap
                     }
                     let shorterBy =
                        Math.abs(minDisp[axis]) - Math.abs(displace)
                     if (shorterBy > 0.01) {
                        minDisp[axis] = displace
                        closestPairs[axis] = new Set([[thingA, thingB]])
                     } else if (shorterBy > -0.01) {
                        closestPairs[axis].add([thingA, thingB])
                     }
                  }
               }
            }
         }
         // Compute the ease vector.
         evaluateDisplacement("x")
         evaluateDisplacement("y")
         function evaluateDisplacement(axis: "x" | "y") {
            if (Math.abs(minDisp[axis]) >= easeRadius /* too far to ease */) {
               minDisp[axis] = 0
               closestPairs[axis] = new Set()
            } else if (Math.abs(minDisp[axis]) >= snapRadius /* ease */) {
               minDisp[axis] =
                  Math.sign(minDisp[axis]) * easeFn(Math.abs(minDisp[axis]))
               closestPairs[axis] = new Set()
            }
         }
         // Express the ease vector in canvas coordinates and return it.
         return new Vector(minDisp.x, minDisp.y).undoRelativeTo(easeAxes.x)
      }
   }
   function endMove() {
      if (!move) return
      if (move.draw) {
         let segment = move.draw.segment
         let endObject = move.draw.endObject
         function isAcceptableTEMP() {
            if (segment.start instanceof Port) return true
            for (let [s, other] of segment.start.edges) {
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
         if (segment.sqLength() >= sqMinSegmentLength && isAcceptableTEMP()) {
            if (endObject instanceof Segment) {
               // Turn the intersected Segment into a T-junction.
               endObject.cutAt(segment.end as Junction)
            } else if (endObject) {
               // Replace the drawn segment with one that ends at the Vertex.
               segment.replaceWith(
                  new Segment(segment.start, endObject, segment.axis)
               )
               if (shouldExtendTheLineAt(endObject, segment.axis))
                  endObject.convertToCrossing(crossingMap)
            }
         } else deleteSelected()
         // Reset the drawing state.
         if (move.draw.segmentIsNew || endObject) selected = new ToggleSet()
      }
      move = null
      if (tool === "draw") selected = new ToggleSet()
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function beginRectSelect(start: Point) {
      rectSelect = new Set()
   }
   function updateRectSelect() {
      if (!rectSelect || mouse.state === "up") return
      rectSelect = new Set()
      let range = Range2D.fromCorners(mouse.downPosition, mouse.position)
      // Highlight Junctions and Segments.
      for (let start of Junction.s) {
         if (range.contains(start)) {
            let segmentAdded = false
            for (let [segment, end] of start.edges) {
               if (range.contains(end)) {
                  rectSelect.add(segment)
                  segmentAdded = true
               }
            }
            if (!segmentAdded) {
               rectSelect.add(start)
            }
         }
      }
      // Don't highlight Junctions if their Segment is already selected.
      for (let thing of selected) {
         if (thing instanceof Segment) {
            rectSelect.delete(thing.start as Junction)
            rectSelect.delete(thing.end as Junction)
         }
      }
      for (let symbol of SymbolInstance.s) {
         // Highlight enclosed symbols.
         if (symbol.svgCorners().every((c) => range.contains(c))) {
            rectSelect.add(symbol)
         }
      }
   }
   function endRectSelect() {
      if (rectSelect) {
         if (!shift && !alt) selected.clear()
         if (alt) {
            for (let thing of rectSelect) selected.delete(thing)
         } else {
            for (let thing of rectSelect) selected.add(thing)
         }
         selected = selected
      }
      rectSelect = null
   }

   // --------------------- Development-time behaviours -----------------------
   onMount(() => {
      // After a hot reload, the SVGs of symbols must re-inserted into the DOM.
      for (let symbol of SymbolInstance.s) symbol.refresh()
   })
</script>

<svg
   bind:this={canvas}
   style="cursor: {cursor}"
   on:mousedown={(event) => {
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (leftMouseIsDown(event)) leftMouseDown()
   }}
   on:mousemove={(event) => {
      let previousMousePosition = mouse.position
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event) && mouse.state !== "up") {
         if (waitedOneFrame) {
            if (mouse.state === "pressing") leftMousePressEnded(true)
            if (mouse.state === "dragging") leftMouseDragEnded(true)
            waitedOneFrame = false
         } else waitedOneFrame = true
      }
      mouseMoved(previousMousePosition)
   }}
   on:mouseup={(event) => {
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event)) {
         if (mouse.state === "pressing") leftMouseClicked()
         if (mouse.state === "dragging") leftMouseDragEnded()
      }
   }}
   on:mouseenter={(event) => {
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event)) {
         if (mouse.state === "pressing") leftMousePressEnded(true)
         if (mouse.state === "dragging") leftMouseDragEnded(true)
      }
   }}
>
   <!-- Symbol highlight/selection layer -->
   <g>
      {#each [...SymbolInstance.s] as symbol}
         {@const c = symbol.svgCorners()}
         {#if highlighted.has(symbol) || selected.has(symbol)}
            <polygon
               style="stroke-width: 8px"
               class="symbolHighlight fill stroke {selected.has(symbol)
                  ? 'select'
                  : 'hover'}"
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
         {#if selected.has(segment)}
            {#each sections as section}
               <FluidLine renderStyle="select" segment={section} />
            {/each}
         {/if}
      {/each}
   </g>
   <!-- Segment layer -->
   <g>
      {#each [...segmentsToDraw] as [_, sections]}
         {#each sections as section}
            <FluidLine segment={section} />
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
            <Hopover start={glyph.start} end={glyph.end} flip={glyph.flip} />
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
      {#if rectSelect && mouse.state !== "up"}
         <RectSelectBox start={mouse.downPosition} end={mouse.position} />
      {/if}
   </g>
</svg>

<style>
   svg {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
   }
</style>
