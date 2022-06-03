<script lang="ts">
   // Imports
   import {
      Tool,
      Junction,
      Port,
      SymbolKind,
      SymbolInstance,
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
   import VertexMarker from "~/components/VertexMarker.svelte"
   import RectSelectBox from "~/components/RectSelectBox.svelte"
   import Plug from "~/components/lines/Plug.svelte"
   // Root element
   let canvas: SVGElement
   // Input props
   export let tool: Tool
   export let shift: boolean
   export let alt: boolean
   export let cmd: boolean
   export let onSymbolLeave: (
      kind: SymbolKind,
      grabOffset: Vector,
      event: MouseEvent
   ) => void
   // Output props
   export const onDelete = deleteSelected
   export const onSymbolEnter = spawnSymbol
   // Response to props changing
   $: {
      if (tool === "hydraulic line") selected = new ToggleSet()
   }
   $: {
      shift ? shiftDown() : shiftUp()
   }
   $: {
      alt ? altDown() : altUp()
   }
   $: {
      cmd ? cmdDown() : cmdUp()
   }
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   // Configurable constants
   const sqMinSegmentLength = 15 * 15
   // The error ratio (between 0 and 1) at which two axes should be considered
   // parallel. A non-zero tolerance is required to circumvent numerical error.
   const axisErrorTolerance = 0.004
   // Circuit-sizing constants
   const standardGap = 30 // standard spacing between scene elements
   const halfGap = standardGap / 2
   const hopoverRadius = halfGap / 2
   const gapSelectError = 1 // diff from standardGap acceptable to gap select
   // Snapping constants
   const easeRadius = 30 // dist btw mouse & snap point at which easing begins
   const snapRadius = 15 // dist btw mouse & snap point at which snapping occurs
   const snapJump = 5 // the distance things move at the moment they snap
   const sqEaseRadius = easeRadius * easeRadius
   const sqSnapRadius = snapRadius * snapRadius
   // The default axes used for snapping.
   const snapAxes = [
      Axis.horizontal,
      Axis.vertical,
      Axis.fromAngle(0.125 * tau), // 45 degrees
      Axis.fromAngle(0.375 * tau), // 135 degrees
   ]
   // ✨ A magical easing function for aesthetically-pleasing snapping. We
   // displace the source from its true position as it approaches the target.
   function easeFn(distance: number) {
      const a =
         (snapRadius - snapJump) /
         (sqSnapRadius + sqEaseRadius - 2 * snapRadius * easeRadius)
      const b = -2 * a * easeRadius
      const c = -a * sqEaseRadius - b * easeRadius
      return a * distance * distance + b * distance + c
   }
   type EasingOutcome =
      | { outcome: "snapped"; point: Point }
      | { outcome: "eased"; point: Point }
      | { outcome: "no easing"; point: Point }
   function easeToTarget(source: Point, target?: Point): EasingOutcome {
      if (!target) return { outcome: "no easing", point: source }
      // Easing constants
      let sqDistance = source.sqDistanceFrom(target)
      if (sqDistance < sqSnapRadius) {
         return { outcome: "snapped", point: target }
      } else if (sqDistance < sqEaseRadius) {
         let easeDir = target.directionFrom(source) as Direction
         let distance = Math.sqrt(sqDistance)
         return {
            outcome: "eased",
            point: source.displacedBy(easeDir.scaledBy(easeFn(distance))),
         }
      } else return { outcome: "no easing", point: source }
   }
   function closestNearTo<T extends Object2D>(
      point: Point,
      ...objectSets: Iterable<T>[]
   ): ClosenessResult<T> {
      let closest = closestTo(point, ...objectSets)
      if (closest && closest.closestPart.sqDistanceFrom(point) < sqSnapRadius) {
         return closest
      }
   }
   function closestSegmentNearTo(
      point: Point,
      alongAxis: Axis
   ): ClosenessResult<Segment> {
      let closest = closestSegmentTo(point, alongAxis, segments)
      let sqBuffer = hopoverRadius * hopoverRadius
      if (
         closest &&
         closest.closestPart.sqDistanceFrom(point) < sqSnapRadius &&
         closest.closestPart.sqDistanceFrom(closest.object.start) >= sqBuffer &&
         closest.closestPart.sqDistanceFrom(closest.object.end) >= sqBuffer
      ) {
         return closest
      }
   }
   type Attachable = Vertex | Segment // Something a segment can be attached to.
   type Toggleable = Vertex | Segment | Crossing
   type Grabbable = Vertex | Segment | SymbolInstance // === Selectable
   type Highlightable = Point | Segment | SymbolInstance
   function closestAttachable(point: Point): ClosenessResult<Attachable> {
      return closestNearTo(point, vertices()) || closestNearTo(point, segments)
   }
   function closestToggleable(point: Point): ClosenessResult<Toggleable> {
      return (
         closestNearTo<Vertex | Crossing>(point, vertices(), crossings()) ||
         closestNearTo(point, segments)
      )
   }
   function closestAttachableOrToggleable(
      point: Point
   ): ClosenessResult<Attachable | Toggleable> {
      // This additional function is necessary because the individual functions
      // don't compose.
      return (
         closestNearTo<Vertex | Crossing>(point, vertices(), crossings()) ||
         closestNearTo(point, segments)
      )
   }
   function closestGrabbable(point: Point): ClosenessResult<Grabbable> {
      return (
         closestNearTo(point, vertices()) ||
         closestNearTo(point, symbols) ||
         closestNearTo(point, segments)
      )
   }
   // --------------- State ---------------
   type Vertex = Junction | Port
   function isVertex(thing: any): thing is Vertex {
      return thing instanceof Junction || thing instanceof Port
   }
   // Specialize the notions of Segments and Crossings to our needs.
   type Segment = Geometry.Segment<Vertex>
   const Segment = Geometry.Segment // eslint-disable-line
   type Crossing = Geometry.Crossing<Vertex>
   const Crossing = Geometry.Crossing // eslint-disable-line
   // The primary encoding of the circuit is an adjacency list. This supports
   // efficient graph traversals. The edges are are given stable identities as
   // Segment objects so that they can be referenced from other data structures.
   type OutgoingEdge = [Segment, Vertex]
   type Circuit = DefaultMap<Vertex, Set<OutgoingEdge>>
   let circuit: Circuit = new DefaultMap(() => new Set())
   function* vertices() {
      for (let p of circuit.keys()) yield p
      // TODO: This is a hack, because not all Ports are in the Circuit.
      for (let p of ports()) yield p
   }
   let segments = new Set<Segment>() // for direct access to circuit segments
   // We store the multiplicity of every axis in the circuit, so that if all
   // the segments aligned to a given axis are removed, the axis is forgotten.
   let circuitAxes = new DefaultMap<Axis, number>(() => 0)
   // We store how each vertex in the circuit should be rendered.
   let vertexGlyphs = new DefaultMap<Point, "default" | "plug">(() => "default")
   // For each pair of segments, we store how their crossing should be rendered.
   type CrossingType = "H up" | "H down" | "V left" | "V right" | "no hop"
   let crossingTypes: DefaultMap<
      Segment,
      DefaultMap<Segment, CrossingType>
   > = new DefaultMap(() => new DefaultMap(() => "H up"))
   const crossingToggleSeq: CrossingType[] = [
      "no hop",
      "V right",
      "H down",
      "V left",
      "H up",
   ]
   // Because the presence of hopovers is independent of the circuit topology,
   // the circuit topology does not directly determine the SVG paths & lines
   // that need to be rendered. We compute the required SVG paths & lines below.
   let crossingMap: DefaultMap<Segment, Map<Segment, Point>>
   function* crossings() {
      for (let [seg1, map] of crossingMap) {
         for (let [seg2, point] of map) yield new Crossing(seg1, seg2, point)
      }
   }
   $: {
      crossingMap = new DefaultMap(() => new Map())
      for (let seg1 of segments) {
         for (let seg2 of segments) {
            if (segmentsConnect(seg1, seg2)) continue
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
   type Section = Geometry.Segment<Point>
   let segmentsToDraw: Map<Segment, Section[]>
   type Glyph =
      | {
           type: "hopover"
           segment: Segment
           point: Point
           start: Point
           end: Point
           flip: boolean
        }
      | { type: "junction node"; junction: Junction }
      | { type: "plug"; vertex: Vertex }
      | { type: "vertex marker"; point: Point }
   let glyphsToDraw: Set<Glyph>
   $: {
      segmentsToDraw = new Map()
      glyphsToDraw = new Set()
      for (let segment of segments) {
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
            let type = crossingTypes.read(segment).read(other)
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
               })
            } else if (type === "no hop" && highlighted.has(crossPoint)) {
               glyphsToDraw.add({ type: "vertex marker", point: crossPoint })
            }
         }
         // Compute the sections that need to be drawn.
         let distanceOf = (p: Point) => p.sqDistanceFrom(segment.start)
         points.sort((a, b) => distanceOf(a) - distanceOf(b))
         let sections: Section[] = []
         for (let i = 0; i < points.length; i += 2) {
            sections.push(
               new Geometry.Segment(points[i], points[i + 1], segment.axis)
            )
         }
         segmentsToDraw.set(segment, sections)
      }
      // Determine the other glyphs that need to be drawn at vertices.
      for (let [p, edges] of circuit) {
         if (vertexGlyphs.read(p) === "plug") {
            glyphsToDraw.add({ type: "plug", vertex: p })
         } else if (p instanceof Junction) {
            if (edges.size > 2) {
               glyphsToDraw.add({ type: "junction node", junction: p })
            } else if (straightAt(p) || highlighted.has(p) || selected.has(p)) {
               glyphsToDraw.add({ type: "vertex marker", point: p })
            }
         }
      }
      // Determine the glyphs that need to be drawn at symbol attachment points.
      for (let symbol of symbols) {
         for (let p of symbol.ports) {
            if (highlighted.has(p)) {
               glyphsToDraw.add({ type: "vertex marker", point: p })
            }
         }
      }
   }

   function segmentsConnect(s1: Segment, s2: Segment) {
      return (
         s1.start === s2.start ||
         s1.start === s2.end ||
         s1.end === s2.start ||
         s1.end === s2.end
      )
   }
   function straightAt(junction: Junction) {
      let edges = circuit.read(junction)
      if (edges.size !== 2) return false
      let axes = []
      for (let [{ axis }] of edges) axes.push(axis)
      return axes[0] === axes[1]
   }
   function addSegment(segment: Segment) {
      circuit.getOrCreate(segment.start).add([segment, segment.end])
      circuit.getOrCreate(segment.end).add([segment, segment.start])
      segments.add(segment)
      circuitAxes.update(segment.axis, (c) => c + 1)
   }
   // Delete the given segment. (To replace a segment with a different one,
   // "replaceSegment" should be used instead.)
   function deleteSegment(segment: Segment) {
      // Delete from "circuit"
      let startEdges = circuit.read(segment.start)
      for (let edge of startEdges) {
         if (edge[0] === segment) {
            startEdges.delete(edge)
            if (startEdges.size === 0) circuit.delete(segment.start)
            break
         }
      }
      let endEdges = circuit.read(segment.end)
      for (let edge of endEdges) {
         if (edge[0] === segment) {
            endEdges.delete(edge)
            if (endEdges.size === 0) circuit.delete(segment.end)
            break
         }
      }
      // Delete from "segments"
      segments.delete(segment)
      // Delete from "circuitAxes"
      let count = circuitAxes.read(segment.axis)
      if (count > 1) {
         circuitAxes.set(segment.axis, count - 1)
      } else {
         circuitAxes.delete(segment.axis)
      }
      // Delete from "crossingTypes"
      crossingTypes.delete(segment)
      for (let map of crossingTypes.values()) {
         map.delete(segment)
      }
      circuit = circuit
      segments = segments
   }
   // Replace the given segment with another segment (or several),
   // transferring all of the deleted segment's properties.
   function replaceSegment(segment: Segment, ...segs: Segment[]) {
      for (let seg of segs) {
         addSegment(seg)
         // Transfer the crossing types associated with the old segment.
         crossingTypes.set(seg, crossingTypes.read(segment).clone())
         for (let map of crossingTypes.values()) {
            map.set(seg, map.read(segment))
         }
      }
      deleteSegment(segment)
   }
   function deleteSelected() {
      let junctionsToConvert = new Set<Vertex>()
      for (let thing of selected) {
         if (thing instanceof Junction) {
            // Delete all neighbouring segments.
            for (let [segment] of circuit.read(thing)) {
               deleteSegment(segment)
               junctionsToConvert.add(segment.start)
               junctionsToConvert.add(segment.end)
            }
         } else if (thing instanceof Segment) {
            deleteSegment(thing)
            junctionsToConvert.add(thing.start)
            junctionsToConvert.add(thing.end)
         } else if (thing instanceof SymbolInstance) {
            symbols.delete(thing)
         }
      }
      for (let vertex of junctionsToConvert) {
         if (vertex instanceof Junction && circuit.read(vertex).size === 2)
            convertToCrossing(vertex)
      }
      selected = new ToggleSet()
   }
   function cutSegment(segment: Segment, cutPoint: Junction) {
      let { start, end } = segment
      let axis = Axis.fromVector(start.displacementFrom(end))
      if (axis) {
         axis = findExistingAxis(axis)
         replaceSegment(
            segment,
            new Segment(cutPoint, start, axis),
            new Segment(cutPoint, end, axis)
         )
      }
   }
   // If the junction is an X-junction, or a pair of colinear segments,
   // convert it into a crossing.
   function convertToCrossing(junction: Junction) {
      let parts = partsOfJunction(junction)
      let crossing = []
      for (let segs of parts) {
         let mergedSegment = new Segment(
            junction === segs[0].start ? segs[0].end : segs[0].start,
            junction === segs[1].start ? segs[1].end : segs[1].start,
            segs[0].axis
         )
         addSegment(mergedSegment)
         crossing.push(mergedSegment)
         // Merge the crossing types of the old segments into the new one.
         // The merge strategy is: if segs[0] is currently crossing another
         // segment, use that crossing type. Otherwise, use seg[1]'s type.
         let mergedTypes = crossingTypes.read(segs[1]).clone()
         let seg0Crossings = crossingMap.read(segs[0])
         let seg0Types = crossingTypes.read(segs[0])
         for (let crossSegment of segments) {
            if (seg0Crossings.has(crossSegment)) {
               mergedTypes.set(crossSegment, seg0Types.read(crossSegment))
            }
         }
         crossingTypes.set(mergedSegment, mergedTypes)
         for (let [s, map] of crossingTypes) {
            map.set(mergedSegment, mergedTypes.read(s))
         }
         // Get rid of the old segments.
         deleteSegment(segs[0])
         deleteSegment(segs[1])
      }
      if (crossing.length === 2) {
         // Set the crossing type of the crossing itself.
         crossingTypes
            .getOrCreate(crossing[0])
            .set(crossing[1], crossingToggleSeq[0])
         crossingTypes
            .getOrCreate(crossing[1])
            .set(crossing[0], crossingToggleSeq[0])
      }
      crossingTypes = crossingTypes
   }
   function convertToJunction(crossing: Crossing) {
      let cutPoint = new Junction(crossing.point)
      cutSegment(crossing.seg1, cutPoint)
      cutSegment(crossing.seg2, cutPoint)
   }
   // If the junction is an X-junction, or a pair of colinear segments, return
   // each pair of colinear segments. Otherwise, return nothing.
   function partsOfJunction(junction: Junction): Set<[Segment, Segment]> {
      let edges = circuit.read(junction)
      if (edges.size !== 2 && edges.size !== 4) return new Set()
      let axes = new DefaultMap<Axis, OutgoingEdge[]>(() => [])
      for (let edge of edges) {
         axes.getOrCreate(edge[0].axis).push(edge)
      }
      let pairs = new Set<[Segment, Segment]>()
      for (let edgePair of axes.values()) {
         if (edgePair.length !== 2) return new Set()
         pairs.add([edgePair[0][0], edgePair[1][0]])
      }
      return pairs
   }
   // Find an existing Axis object in the circuit that is equivalent to the
   // given Axis. If no such Axis exists, return the original axis.
   function findExistingAxis(subject: Axis): Axis {
      for (let axis of snapAxes) {
         if (subject.approxEquals(axis, axisErrorTolerance)) return axis
      }
      for (let axis of circuitAxes.keys()) {
         if (subject.approxEquals(axis, axisErrorTolerance)) return axis
      }
      return subject
   }
   function axesAt(junction: Junction): Axis[] {
      let axes: Axis[] = []
      for (let [segment] of circuit.read(junction))
         if (!axes.includes(segment.axis)) axes.push(segment.axis)
      return axes
   }
   // Input state
   let mouse: Point = Point.zero
   let cursor: "auto" | "grab" | "grabbing" | "cell"
   $: {
      if (move) {
         cursor = "grabbing"
      } else {
         cursor = "auto"
         let grab = closestGrabbable(mouse)
         if (tool === "select & move" && grab && !shift && !alt && !cmd) {
            cursor = waitingForDrag ? "grabbing" : "grab"
         }
      }
   }
   let waitingForDrag: Point | null = null
   let highlighted: Set<Highlightable>
   $: {
      highlighted = new Set()
      if (draw?.endObject instanceof Segment) {
         highlighted.add(draw.endObject)
      } else if (rectSelect) {
         highlighted = new Set(rectSelect.highlighted)
      } else if (bulkHighlighted.size > 0) {
         for (let s of bulkHighlighted) highlighted.add(s)
      } else if (tool === "select & move" && !move) {
         let grab = closestGrabbable(mouse)
         if (grab) highlighted.add(grab.object)
      } else if (tool === "hydraulic line" && !move) {
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
   let bulkHighlighted: Set<Segment>
   $: /* When activated, highlight all objects which are standardGap apart.*/ {
      if (tool === "select & move" && !move && cmd) {
         bulkHighlighted = new Set()
         let s = closestNearTo(mouse, segments)
         if (s) {
            // Do bulk highlighting (and later, selection) along the axis
            // orthogonal to the segment's axis. To achieve this, we
            // re-coordinatize every object that has the same orientation as
            // the segment as an AABB, and search along the resultant y-axis.
            let selectAxis = s.object.axis
            let orthAxis = findExistingAxis(selectAxis.orthogonal())
            type SegmentInfo = {
               segment: Segment
               x: number[]
               y: number[]
               visited: boolean
            }
            let info = new Map<Segment, SegmentInfo>()
            for (let seg of segments) {
               if (seg.axis !== selectAxis && seg.axis !== orthAxis) continue
               let start = Point.zero.displacedBy(
                  seg.start.displacementFrom(Point.zero).relativeTo(selectAxis)
               )
               let end = Point.zero.displacedBy(
                  seg.end.displacementFrom(Point.zero).relativeTo(selectAxis)
               )
               let x = start.x <= end.x ? [start.x, end.x] : [end.x, start.x]
               let y = start.y <= end.y ? [start.y, end.y] : [end.y, start.y]
               info.set(seg, { segment: seg, x, y, visited: false })
            }
            let [front, back] =
               s.closestPart.displacementFrom(mouse).relativeTo(selectAxis).y >
               0
                  ? [0, 1]
                  : [1, 0]
            bulkHighlighted.add(s.object)
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
                     bulkHighlighted.add(i.segment)
                     i.visited = true
                     highlightFrom(i)
                  }
               }
            }
         }
      } else {
         bulkHighlighted = new Set()
      }
   }
   let selected: ToggleSet<Grabbable> = new ToggleSet()
   function selectedVertices(): Set<Vertex> {
      let s = new Set<Vertex>()
      for (let thing of selected) {
         if (isVertex(thing)) {
            s.add(thing)
         } else if (thing instanceof Segment) {
            s.add(thing.start)
            s.add(thing.end)
         }
         // TODO: Remove the "move.points" abstraction entirely. It doesn't
         // make sense now that the move() operation moves Symbols too!
      }
      return s
   }
   let draw: {
      mode: "strafing" | "fixed-axis rotation" | "free rotation"
      segment: Segment
      segmentIsNew: boolean
      endObject?: Attachable
   } | null = null
   let move: {
      points: Set<Vertex>
      locationGrabbed: Point
      axisGrabbed: Axis
      offset: Vector
      distance: number
      originalPositions: DefaultMap<Junction | SymbolInstance, Point>
   } | null = null
   let rectSelect: {
      start: Point
      end: Point
      highlighted: Set<Grabbable>
   } | null = null

   function beginDraw(start: Vertex, axis: Axis) {
      // Add the line being drawn to the circuit.
      let end = new Junction(start)
      let segment = new Segment(start, end, axis)
      addSegment(segment)
      draw = { mode: "strafing", segment, segmentIsNew: true }
      // Configure the endpoint of the line to be dragged as the mouse moves.
      selected = new ToggleSet([end])
      beginMove(end, end)
   }
   $: {
      if (draw && move) {
         if (alt) {
            draw.mode = shift ? "free rotation" : "fixed-axis rotation"
         } else {
            draw.mode = "strafing"
         }
         if (draw.mode === "fixed-axis rotation") {
            // Check which axis the mouse is closest to. If the axis has
            // changed, restart the drawing operation along the new axis.
            let drawVector = mouse.displacementFrom(draw.segment.start)
            let maybeAxis = Axis.fromVector(drawVector)
            if (maybeAxis) {
               let newAxis = findExistingAxis(maybeAxis)
               // Snap to the nearest standard axis.
               let scores = snapAxes.map((axis) => Math.abs(newAxis.dot(axis)))
               newAxis = snapAxes[scores.indexOf(Math.max(...scores))]
               if (newAxis !== draw.segment.axis) {
                  // Replace the existing segment.
                  let end = new Junction(
                     draw.segment.start.displacedBy(
                        drawVector.projectionOnto(newAxis)
                     )
                  )
                  let newSegment = new Segment(draw.segment.start, end, newAxis)
                  replaceSegment(draw.segment, newSegment)
                  // Patch the draw and move operations.
                  draw.segment = newSegment
                  selected = new ToggleSet([end])
                  beginMove(end, end)
                  move.offset = zeroVector
               }
            }
         } else if (draw.mode === "free rotation") {
            // To accommodate for the constantly-changing drawing axis, the draw
            // operation is restarted from scratch every update. (This is a bit
            // of a hack, but it's the simplest way to integrate "free
            // rotation" with the other drawing modes.)
            function isAcceptableTEMP(vertex: Vertex) {
               let start = draw!.segment.start
               let maybeAxis = Axis.fromVector(vertex.displacementFrom(start))
               if (!maybeAxis) return false
               let drawAxis = findExistingAxis(maybeAxis)
               for (let [{ axis }, other] of circuit.read(vertex)) {
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
               mouse,
               Array.from(vertices()).filter(isAcceptableTEMP)
            )
            let maybeAxis = Axis.fromVector(
               closest
                  ? closest.object.displacementFrom(draw.segment.start)
                  : mouse.displacementFrom(draw.segment.start)
            )
            if (maybeAxis) {
               let newAxis = findExistingAxis(maybeAxis)
               // Replace the existing segment.
               let end = new Junction(closest ? closest.object : mouse)
               let newSegment = new Segment(draw.segment.start, end, newAxis)
               replaceSegment(draw.segment, newSegment)
               // Patch the draw and move operations.
               draw.segment = newSegment
               selected = new ToggleSet([end])
               beginMove(end, end)
               move.offset = zeroVector
               // Do snapping.
               if (closest) {
                  draw.endObject = closest.object
               } else {
                  let s = closestSegmentNearTo(mouse, newAxis)
                  if (s) {
                     draw.segment.end.moveTo(s.closestPart)
                     draw.endObject = s.object
                  } else {
                     draw.endObject = undefined
                  }
               }
            }
            circuit = circuit
            segments = segments
         } else {
            // The rest of the drawing logic is co-located with the move logic.
         }
      }
   }
   function endDraw() {
      if (!draw) return
      endMove()
      let segment = draw.segment
      function isAcceptableTEMP() {
         for (let [s, other] of circuit.read(draw!.segment.start)) {
            if (
               s !== segment &&
               s.axis === draw!.segment.axis &&
               other.distanceFrom(draw!.segment.end) + 1 <
                  draw!.segment.start.distanceFrom(draw!.segment.end) +
                     other.distanceFrom(draw!.segment.start)
            )
               return false
         }
         return true
      }
      if (segment.sqLength() >= sqMinSegmentLength && isAcceptableTEMP()) {
         if (draw.endObject instanceof Segment) {
            // Turn the intersected Segment into a T-junction.
            cutSegment(draw.endObject, segment.end as Junction)
         } else if (draw.endObject) {
            // Replace the drawn segment with one that ends at the Vertex.
            replaceSegment(
               segment,
               new Segment(segment.start, draw.endObject, segment.axis)
            )
         }
      } else deleteSelected()
      // Reset the drawing state.
      if (draw.segmentIsNew) selected = new ToggleSet()
      draw = null
   }
   function beginMove(thingGrabbed: Grabbable, pointGrabbed: Point) {
      // Find the Axis that the moved objects should snap along & orthogonal to.
      let axisGrabbed
      if (thingGrabbed instanceof Segment) {
         axisGrabbed = thingGrabbed.axis
      } else if (thingGrabbed instanceof SymbolInstance) {
         axisGrabbed = findExistingAxis(
            Axis.fromDirection(thingGrabbed.direction())
         )
      } else {
         let _
         let axis = Axis.horizontal
         for ([{ axis }] of circuit.read(thingGrabbed)) {
            // Prefer horizontal and vertical axes.
            if (axis === Axis.horizontal || axis === Axis.vertical) break
         }
         axisGrabbed = axis
      }
      // Record the position of every Grabbable in the circuit prior to movement.
      // We need to use these positions as a reference, because we will be
      // mutating the position (Point) objects over the course of the movement.
      let originalPositions = new DefaultMap<Junction | SymbolInstance, Point>(
         () => Point.zero
      )
      for (let vertex of vertices()) {
         originalPositions.set(vertex, vertex.clone())
      }
      move = {
         points: selectedVertices(),
         locationGrabbed: pointGrabbed.clone(),
         axisGrabbed,
         offset: pointGrabbed.displacementFrom(mouse),
         distance: 0,
         originalPositions,
      }
      // If moving a single Point which is a loose end, treat the move
      // operation as a draw operation.
      if (!draw && move.points.size === 1) {
         let end
         for (end of move.points) {
         }
         end = end as Vertex
         let edges = circuit.read(end)
         if (edges.size === 1) {
            let existingSegment, start
            for ([existingSegment, start] of edges) {
            }
            existingSegment = existingSegment as Segment
            start = start as Vertex
            // The existing segment may be "backwards". We need to replace
            // it with a segment whose .end is the vertex being grabbed.
            let segment = new Segment(start, end, existingSegment.axis)
            replaceSegment(existingSegment, segment)
            draw = { mode: "strafing", segment, segmentIsNew: false }
         }
      }
   }
   // ----- Compute the state of an in-progress move operation -----
   $: /* On a change to 'draw, 'move', or 'mouse' */ {
      if (move && draw?.mode !== "free rotation") {
         let drawingEdgeCase = draw && axesAt(draw.segment.start).length !== 2
         type MoveInfo = {
            moveType: "no move" | Axis | "full move"
            vector: Vector
         }
         // This is a "global variable" throughout the forthcoming operations.
         let moveInfo = new DefaultMap<Vertex, MoveInfo>(() => {
            return { moveType: "no move", vector: zeroVector }
         })
         // Firstly, perform a simple movement that tracks the mouse.
         let fullMove = mouse.displacementFrom(move.locationGrabbed)
         if (move.distance < 15) {
            // The user may have grabbed slightly-away from their target
            // object. If so, pull the object towards the mouse cursor.
            fullMove = fullMove.add(
               move.offset.scaledBy(1 - move.distance / 15)
            )
         }
         if (draw && draw.mode === "fixed-axis rotation") {
            fullMove = fullMove.projectionOnto(draw.segment.axis)
            moveVertex(draw.segment.end, fullMove)
         } else {
            doMove(fullMove)
         }
         let snappedToPoint = false
         if (draw && draw.mode === "strafing") {
            // Try snapping the moved Vertex to another Vertex nearby.
            function isAcceptableTEMP(vertex: Vertex) {
               if (moveInfo.read(vertex).moveType !== "no move") return false
               let start = draw!.segment.start
               for (let [{ axis }, other] of circuit.read(vertex)) {
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
               Array.from(vertices()).filter(isAcceptableTEMP)
            )
            if (closest) {
               snappedToPoint = true
               let snappedMove = closest.object.displacementFrom(
                  move.locationGrabbed
               )
               doMove(snappedMove)
               draw.endObject = closest.object
            } else {
               draw.endObject = undefined
            }
         }
         if (!snappedToPoint) {
            // Snap axis-aligned objects to a "standardGap" distance apart.
            let snapGap = computeStandardGapSnap()
            let snappedMove =
               move.distance < 15
                  ? fullMove.add(snapGap.scaledBy(move.distance / 15))
                  : fullMove.add(snapGap)
            if (draw && draw.mode === "fixed-axis rotation") {
               snappedMove = snappedMove.projectionOnto(draw.segment.axis)
               moveVertex(draw.segment.end, snappedMove)
            } else {
               doMove(snappedMove)
            }
            if (draw) {
               // Try snapping the endpoint to nearby segments.
               let s = closestSegmentNearTo(draw.segment.end, draw.segment.axis)
               if (s) {
                  draw.segment.end.moveTo(s.closestPart)
                  draw.endObject = s.object
               } else {
                  draw.endObject = undefined
               }
            }
         }

         function moveVertex(v: Vertex, vector: Vector) {
            moveInfo.set(v, { moveType: "full move", vector })
            v.moveTo(move!.originalPositions.read(v).displacedBy(vector))
            circuit = circuit
            segments = segments
         }
         function doMove(vector: Vector) {
            function specialMove() {
               moveInfo.set(draw!.segment.end, {
                  moveType: "full move",
                  vector,
               })
               propagateMovement(
                  draw!.segment.start,
                  null,
                  vector.rejectionFrom(draw!.segment.axis)
               )
            }
            // Compute the movement of every Grabbable in the circuit.
            moveInfo.clear()
            if (draw && drawingEdgeCase) {
               specialMove()
            } else if (draw) {
               // Try a normal move.
               for (let vertex of move!.points) {
                  propagateMovement(vertex, null, vector)
               }
               // If we weren't able to alter the length of the segment being
               // drawn, resort to a special move.
               if (moveInfo.read(draw.segment.start).moveType === "full move") {
                  moveInfo.clear()
                  specialMove()
               }
            } else {
               // Do a normal move.
               for (let vertex of move!.points) {
                  propagateMovement(vertex, null, vector)
               }
            }
            // Update the position of each Grabbable.
            for (let vertex of vertices()) {
               vertex.moveTo(
                  move!.originalPositions
                     .read(vertex)
                     .displacedBy(moveInfo.read(vertex).vector)
               )
            }
            circuit = circuit
            segments = segments
         }
         function propagateMovement(
            currentPoint: Vertex, // The vertex we are moving.
            edgeAxis: Axis | null, // The axis of the edge we just followed.
            moveVector: Vector // The movement being propagated.
         ) {
            let current = moveInfo.getOrCreate(currentPoint)
            let axes = axesAt(currentPoint)
            if (edgeAxis && axes.length <= 2 && current.moveType == "no move") {
               // Keep only one component of the movement vector. This allows
               // parts of the circuit to stretch and contract as it is moved.
               current.moveType = edgeAxis
               let otherAxis
               if (axes.length === 2) {
                  otherAxis = edgeAxis === axes[0] ? axes[1] : axes[0]
               } else {
                  otherAxis = edgeAxis.orthogonal()
               }
               // This is (part of) the formula for expressing a vector in
               // terms of a new basis. We express moveVector in terms of
               // (edgeAxis, otherAxis), but we only keep the 2nd component.
               current.vector = otherAxis.scaledBy(
                  (edgeAxis.x * moveVector.y - edgeAxis.y * moveVector.x) /
                     (edgeAxis.x * otherAxis.y - edgeAxis.y * otherAxis.x)
               )
            } else {
               // Move rigidly.
               current.moveType = "full move"
               current.vector = moveVector
            }
            for (let [nextSegment, nextPoint] of circuit.read(currentPoint)) {
               let nextEdgeAxis = nextSegment.axis
               let next = moveInfo.getOrCreate(nextPoint)
               let loneEdge = circuit.read(nextPoint).size === 1
               if (loneEdge && next.moveType !== "full move") {
                  next.moveType = current.moveType
                  next.vector = current.vector
               } else if (
                  next.moveType === "full move" ||
                  next.moveType === nextEdgeAxis
               ) {
                  continue
               } else if (
                  current.moveType === "full move" ||
                  current.moveType === nextEdgeAxis
               ) {
                  propagateMovement(nextPoint, nextEdgeAxis, moveVector)
               }
            }
         }
         function computeStandardGapSnap(): Vector {
            let snapAxis1 = move!.axisGrabbed
            let snapAxis2 = findExistingAxis(move!.axisGrabbed.orthogonal())
            // To start with, compute relevant info about each segment.
            let snapInfo = new Map()
            for (let seg of segments) {
               let start = Point.zero.displacedBy(
                  seg.start.displacementFrom(Point.zero).relativeTo(snapAxis1)
               )
               let end = Point.zero.displacedBy(
                  seg.end.displacementFrom(Point.zero).relativeTo(snapAxis1)
               )
               let s = moveInfo.read(seg.start)
               let e = moveInfo.read(seg.end)
               let sMovesX, sMovesY, eMovesX, eMovesY
               sMovesX = sMovesY = s.moveType === "full move"
               if (s.moveType instanceof Axis) {
                  sMovesX = (s.moveType == seg.axis) !== (seg.axis == snapAxis1)
                  sMovesY = (s.moveType == seg.axis) !== (seg.axis == snapAxis2)
               }
               eMovesX = eMovesY = e.moveType === "full move"
               if (e.moveType instanceof Axis) {
                  eMovesX = (e.moveType == seg.axis) !== (seg.axis == snapAxis1)
                  eMovesY = (e.moveType == seg.axis) !== (seg.axis == snapAxis2)
               }
               let endLoose = drawingEdgeCase && seg === draw?.segment
               let [x1, x2, x1Moves, x2Moves, x1Loose, x2Loose] =
                  start.x <= end.x
                     ? [start.x, end.x, sMovesX, eMovesX, false, endLoose]
                     : [end.x, start.x, eMovesX, sMovesX, endLoose, false]
               let [y1, y2, y1Moves, y2Moves] =
                  start.y <= end.y
                     ? [start.y, end.y, sMovesY, eMovesY]
                     : [end.y, start.y, eMovesY, sMovesY]
               let info = { x1, x2, y1, y2, x1Moves, x2Moves, y1Moves, y2Moves }
               snapInfo.set(seg, { ...info, x1Loose, x2Loose })
            }
            // Using the pre-computed info, find the closest thing that can be
            // snapped to in each of the axial directions.
            let minXSnap = Number.POSITIVE_INFINITY
            let minYSnap = Number.POSITIVE_INFINITY
            for (let segA of segments) {
               if (segA.axis != snapAxis1 && segA.axis != snapAxis2) continue
               let a = snapInfo.get(segA)
               for (let segB of segments) {
                  if (segB.axis != snapAxis1 && segB.axis != snapAxis2) continue
                  let b = snapInfo.get(segB)
                  let notEq = segA !== segB ? 1 : -1
                  // If overlapping wrt. axis X, check distance wrt. axis Y.
                  if (
                     a.x1 <= b.x2 + standardGap &&
                     a.x2 >= b.x1 - standardGap
                  ) {
                     if (a.y1Moves && !b.y2Moves) {
                        let d = b.y2 - a.y1 + standardGap * notEq
                        if (Math.abs(d) < Math.abs(minYSnap)) minYSnap = d
                     }
                     if (a.y2Moves && !b.y1Moves) {
                        let d = b.y1 - a.y2 - standardGap * notEq
                        if (Math.abs(d) < Math.abs(minYSnap)) minYSnap = d
                     }
                  }
                  // If overlapping wrt. axis Y, check distance wrt. axis X.
                  if (
                     a.y1 <= b.y2 + standardGap &&
                     a.y2 >= b.y1 - standardGap
                  ) {
                     if (a.x1Loose || (!a.x2Loose && a.x1Moves && !b.x2Moves)) {
                        let d = b.x2 - a.x1 + standardGap * notEq
                        if (Math.abs(d) < Math.abs(minXSnap)) minXSnap = d
                     }
                     if (a.x2Loose || (!a.x1Loose && a.x2Moves && !b.x1Moves)) {
                        let d = b.x1 - a.x2 - standardGap * notEq
                        if (Math.abs(d) < Math.abs(minXSnap)) minXSnap = d
                     }
                  }
               }
            }
            // Now, perturb the move vector to implement the desired snap.
            if (Math.abs(minXSnap) >= easeRadius /* too far to snap */) {
               minXSnap = 0
            } else if (Math.abs(minXSnap) >= snapRadius /* ease */) {
               minXSnap = Math.sign(minXSnap) * easeFn(Math.abs(minXSnap))
            }
            if (Math.abs(minYSnap) >= easeRadius /* too far to snap */) {
               minYSnap = 0
            } else if (Math.abs(minYSnap) >= snapRadius /* ease */) {
               minYSnap = Math.sign(minYSnap) * easeFn(Math.abs(minYSnap))
            }
            return new Vector(minXSnap, minYSnap).undoRelativeTo(snapAxis1)
         }
      }
   }
   function endMove() {
      move = null
   }
   function beginRectSelect(start: Point) {
      rectSelect = {
         start,
         end: start, // Updated elsewhere
         highlighted: new Set(),
      }
   }
   $: /* On a change to 'rectSelect' or 'mouse' */ {
      if (rectSelect) {
         rectSelect.end = mouse
         rectSelect.highlighted = new Set()
         let range = Range2D.fromCorners(rectSelect.start, rectSelect.end)
         // Highlight segments and their endpoints.
         for (let [start, edges] of circuit) {
            if (range.contains(start)) {
               let segmentAdded = false
               for (let [segment, end] of edges) {
                  if (range.contains(end)) {
                     rectSelect.highlighted.add(segment)
                     segmentAdded = true
                  }
               }
               if (!segmentAdded && !(start instanceof Port)) {
                  rectSelect.highlighted.add(start)
               }
            }
         }
         // Don't highlight endpoints if their segment is already selected.
         for (let thing of selected) {
            if (thing instanceof Segment) {
               rectSelect.highlighted.delete(thing.start)
               rectSelect.highlighted.delete(thing.end)
            }
         }
         for (let symbol of symbols) {
            // Highlight enclosed symbols.
            if (symbol.svgCorners().every((c) => range.contains(c))) {
               rectSelect.highlighted.add(symbol)
            }
         }
      }
   }
   function endRectSelect(cancel?: boolean) {
      if (rectSelect && !cancel) {
         if (!shift && !alt) selected.clear()
         if (alt) {
            for (let thing of rectSelect.highlighted) selected.delete(thing)
         } else {
            for (let thing of rectSelect.highlighted) selected.add(thing)
         }
         selected = selected
      }
      rectSelect = null
   }
   function moveElementToPoint(element: SVGElement, point: Point) {
      element.setAttribute("x", point.x.toString())
      element.setAttribute("y", point.y.toString())
   }
   let symbols = new Set<SymbolInstance>()
   function* ports() {
      for (let symbol of symbols) {
         for (let port of symbol.ports) yield port
      }
   }
   let currentSymbol: { instance: SymbolInstance; grabOffset: Vector } | null =
      null
   function spawnSymbol(kind: SymbolKind, grabOffset: Vector, e: MouseEvent) {
      let initPos = mouseInCoordinateSystemOf(canvas, e).displacedBy(grabOffset)
      let instance = new SymbolInstance(kind, initPos, Rotation.zero)
      symbols.add(instance)
      document.getElementById("symbol layer")?.appendChild(instance.svg)
      currentSymbol = { instance, grabOffset }
   }
   $: {
      if (currentSymbol) {
         let p = mouse.displacedBy(currentSymbol.grabOffset)
         currentSymbol.instance.moveTo(p)
         moveElementToPoint(currentSymbol.instance.svg, p)
         symbols = symbols
      }
   }
   function shiftDown() {}
   function shiftUp() {}
   function altDown() {
      if (draw && move) {
         // Reset the reference information for the movement.
         move.locationGrabbed = draw.segment.end.clone()
         for (let grabbable of move.originalPositions.keys()) {
            if (grabbable instanceof Junction) {
               move.originalPositions.set(grabbable, grabbable.clone())
            } else if (grabbable instanceof SymbolInstance) {
               move.originalPositions.set(grabbable, grabbable.position.clone())
            }
         }
      }
   }
   function altUp() {}
   function cmdDown() {}
   function cmdUp() {}
   // The state the left mouse button SHOULD be in (if the browser hasn't
   // concealed any events from us).
   let leftMouseShouldBeDown = false
   // The state the left mouse button is ACTUALLY in.
   function leftMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b1) === 1
   }
   function leftMouseDown(clickPoint: Point) {
      leftMouseShouldBeDown = true
      switch (tool) {
         case "select & move": {
            let grab = closestGrabbable(clickPoint)
            if (grab && !shift && !alt) {
               if (cmd) {
                  selected.clear()
                  for (let s of bulkHighlighted) selected.add(s)
               } else if (!selected.has(grab.object)) {
                  selected = new ToggleSet([grab.object])
               }
               beginMove(grab.object, grab.closestPart)
            } else waitingForDrag = clickPoint
            break
         }
         case "hydraulic line":
            waitingForDrag = clickPoint
            break
      }
   }
   function mouseMoved(newMouse: Point) {
      if (move) move.distance += newMouse.distanceFrom(mouse)
      mouse = newMouse
      // Check if the mouse has moved enough to trigger an action.
      if (waitingForDrag) {
         let d = mouse.displacementFrom(waitingForDrag)
         switch (tool) {
            case "select & move":
               if (d.sqLength() > 16) {
                  beginRectSelect(waitingForDrag)
                  waitingForDrag = null
               }
               break
            case "hydraulic line":
               if (d.sqLength() > sqSnapRadius) {
                  let drawAxis =
                     Math.abs(d.x) >= Math.abs(d.y)
                        ? Axis.horizontal
                        : Axis.vertical
                  let attach = closestAttachable(waitingForDrag)
                  if (attach) {
                     if (attach.object instanceof Segment) {
                        let cutPoint = new Junction(attach.closestPart)
                        cutSegment(attach.object, cutPoint)
                        beginDraw(cutPoint, drawAxis)
                     } else {
                        beginDraw(attach.object, drawAxis)
                     }
                  } else beginDraw(new Junction(waitingForDrag), drawAxis)
                  waitingForDrag = null
               }
               break
         }
      }
   }
   function leftMouseUp(unexpectedly?: boolean) {
      if (draw) endDraw()
      if (move) endMove()
      if (rectSelect) endRectSelect(unexpectedly)
      waitingForDrag = null
      leftMouseShouldBeDown = false
   }
   function leftMouseClicked() {
      switch (tool) {
         case "select & move": {
            let grab = closestGrabbable(mouse)
            if (!grab) selected.clear()
            else if (shift && cmd)
               for (let s of bulkHighlighted) selected.add(s)
            else if (shift && !cmd) selected.toggle(grab.object)
            else if (alt && cmd)
               for (let s of bulkHighlighted) selected.delete(s)
            else if (alt && !cmd) selected.delete(grab.object)
            else selected = new ToggleSet([grab.object])
            selected = selected
            break
         }
         case "hydraulic line": {
            let toggle = closestToggleable(mouse)
            if (!toggle) break
            if (isVertex(toggle.object)) {
               if (vertexGlyphs.read(toggle.object) === "default") {
                  vertexGlyphs.set(toggle.object, "plug")
               } else {
                  vertexGlyphs.set(toggle.object, "default")
                  if (toggle.object instanceof Junction)
                     convertToCrossing(toggle.object)
               }
               vertexGlyphs = vertexGlyphs
            } else if (toggle.object instanceof Segment) {
               let cutPoint = new Junction(toggle.closestPart)
               cutSegment(toggle.object, cutPoint)
               vertexGlyphs.set(cutPoint, "plug")
            } else if (toggle.object instanceof Crossing) {
               // Change the crossing glyph.
               let { seg1, seg2 } = toggle.object
               let oldType = crossingTypes.read(seg1).read(seg2)
               let i = crossingToggleSeq.indexOf(oldType) + 1
               if (i < crossingToggleSeq.length) {
                  crossingTypes
                     .getOrCreate(seg1)
                     .set(seg2, crossingToggleSeq[i])
                  crossingTypes
                     .getOrCreate(seg2)
                     .set(seg1, crossingToggleSeq[i])
                  crossingTypes = crossingTypes
               } else {
                  convertToJunction(toggle.object)
               }
            }
            break
         }
      }
   }
</script>

<svg
   bind:this={canvas}
   style="cursor: {cursor}"
   on:mousemove={(event) => {
      if (leftMouseShouldBeDown && !leftMouseIsDown(event)) leftMouseUp(true)
      mouseMoved(mouseInCoordinateSystemOf(event.currentTarget, event))
   }}
   on:mousedown={(event) => {
      if (event.button === 0 /* Left mouse button */) {
         leftMouseDown(mouseInCoordinateSystemOf(event.currentTarget, event))
      }
   }}
   on:mouseup={(event) => {
      currentSymbol = null
      if (event.button === 0 /* Left mouse button */) {
         let mouseWasClicked = waitingForDrag
         leftMouseUp()
         if (mouseWasClicked) leftMouseClicked()
      }
   }}
   on:mouseenter={(event) => {
      if (leftMouseShouldBeDown && !leftMouseIsDown(event)) leftMouseUp(true)
   }}
>
   <!-- Symbol highlight/select layer -->
   <g>
      {#each [...symbols] as symbol}
         {@const c = symbol.svgCorners()}
         {#if highlighted.has(symbol) || selected.has(symbol)}
            <polygon
               class={selected.has(symbol)
                  ? "symbolSelectLight"
                  : "symbolHighlight"}
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
               <FluidLine renderType="highlight" segment={section} />
            {/each}
         {/if}
      {/each}
   </g>
   <!-- Segment selection layer -->
   <g>
      {#each [...segmentsToDraw] as [segment, sections]}
         {#if selected.has(segment)}
            {#each sections as section}
               <FluidLine renderType="selectLight" segment={section} />
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
   <!-- Glyph highlight/select layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "hopover" && (selected.has(glyph.segment) || highlighted.has(glyph.segment) || highlighted.has(glyph.point))}
            <Hopover
               renderType={selected.has(glyph.segment)
                  ? "selectLight"
                  : "highlight"}
               start={glyph.start}
               end={glyph.end}
               flip={glyph.flip}
            />
         {:else if glyph.type === "junction node"}
            {#if selected.has(glyph.junction)}
               <JunctionNode
                  renderType="selectLight"
                  position={glyph.junction}
               />
            {:else if highlighted.has(glyph.junction)}
               <JunctionNode renderType="highlight" position={glyph.junction} />
            {/if}
         {:else if glyph.type === "plug"}
            {#if selected.has(glyph.vertex)}
               <Plug renderType="selectLight" position={glyph.vertex} />
            {:else if highlighted.has(glyph.vertex)}
               <Plug renderType="highlight" position={glyph.vertex} />
            {/if}
         {/if}
      {/each}
   </g>
   <!-- Glyph layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "hopover"}
            <Hopover start={glyph.start} end={glyph.end} flip={glyph.flip} />
         {:else if glyph.type === "junction node"}
            <JunctionNode position={glyph.junction} />
         {:else if glyph.type === "plug"}
            <Plug position={glyph.vertex} />
         {/if}
      {/each}
   </g>
   <!-- Symbol layer -->
   <g id="symbol layer" />
   <!-- HUD highlight layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "vertex marker"}
            {#if isVertex(glyph.point) && selected.has(glyph.point)}
               <VertexMarker renderType="selectLight" position={glyph.point} />
            {:else if highlighted.has(glyph.point)}
               <VertexMarker renderType="highlight" position={glyph.point} />
            {/if}
         {/if}
      {/each}
   </g>
   <!-- HUD layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "vertex marker"}
            <VertexMarker position={glyph.point} />{/if}
      {/each}
      {#if rectSelect}
         <RectSelectBox start={rectSelect.start} end={rectSelect.end} />
      {/if}
   </g>
</svg>

<style>
   svg {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
   }
   .symbolHighlight {
      fill: rgb(0, 234, 255);
      stroke: rgb(0, 234, 255);
      stroke-width: 8px;
   }
   .symbolSelectLight {
      fill: yellow;
      stroke: yellow;
      stroke-width: 8px;
   }
</style>
