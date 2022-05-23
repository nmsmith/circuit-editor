<script lang="ts">
   import { Vector, Axis, Point, Line, Ray, Segment } from "./math"
   import { DefaultMap, ToggleSet } from "./utilities"
   import FluidLine from "./lines/FluidLine.svelte"
   import Hopover from "./lines/Hopover.svelte"
   import ConnectionPoint from "./lines/ConnectionPoint.svelte"
   import EndpointMarker from "./lines/EndpointMarker.svelte"
   import RulerHTML from "./Ruler.svelte"
   import { Ruler } from "./Ruler.svelte"
   import Padding from "./Padding.svelte"
   import RectSelectBox from "./RectSelectBox.svelte"
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   // Configurable constants
   const sqMinSegmentLength = 15 * 15
   // The error ratio (between 0 and 1) at which two axes should be considered
   // parallel. A non-zero tolerance is required to circumvent numerical error.
   const axisErrorTolerance = 0.004
   // Snapping constants
   const standardGap = 30 // standard spacing between scene elements
   const halfGap = standardGap / 2
   const hopoverRadius = halfGap / 2
   const gapSelectError = 1 // diff from standardGap acceptable to gap select
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
   function isProximal(source: Point, target: Point): boolean {
      return source.sqDistanceFrom(target) < sqSnapRadius
   }
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
         let easeDir = target.directionFrom(source)
         let distance = Math.sqrt(sqDistance)
         return {
            outcome: "eased",
            point: source.displacedBy(easeDir.scaledBy(easeFn(distance))),
         }
      } else return { outcome: "no easing", point: source }
   }
   // Find the closest endpoint to the given point (if any).
   function closestEndpoint(
      point: Point,
      consider?: (p: Point) => boolean
   ): Point | undefined {
      let closest: { point: Point; sqDistance: number } | undefined
      for (let p of endpoints()) {
         if (consider && !consider(p)) continue
         let current = { point: p, sqDistance: p.sqDistanceFrom(point) }
         closest =
            !closest || current.sqDistance < closest.sqDistance
               ? current
               : closest
      }
      return closest?.point
   }
   function closestProximalEndpoint(
      point: Point,
      consider?: (p: Point) => boolean
   ): Point | undefined {
      let endpoint = closestEndpoint(point, consider)
      if (endpoint && isProximal(point, endpoint)) return endpoint
   }
   // Find the closest segment to the given point (if any).
   function closestSegment(
      point: Point,
      alongAxis?: Axis,
      consider?: (s: Segment) => boolean
   ): { segment: Segment; point: Point } | undefined {
      let closest:
         | { segment: Segment; point: Point; sqDistance: number }
         | undefined
      for (let segment of segments) {
         if (alongAxis && segment.axis === alongAxis) continue
         if (consider && !consider(segment)) continue
         let p = point.displacementFrom(segment.start)
         let s = segment.end.displacementFrom(segment.start)
         let sqLength = s.sqLength()
         let dot = p.dot(s)
         // Only consider the segment if the point's projection lies on it.
         // This occurs iff the dot product is in [0, sqLength).
         // To avoid intersections absurdly close to the ends, we add a buffer.
         let buffer = alongAxis ? (halfGap - 0.001) * s.length() : 0
         if (dot < buffer || dot > sqLength - buffer) continue
         let rejection = s.scaledBy(dot / sqLength).sub(p)
         let current
         if (alongAxis && rejection.sqLength() > 0.001) {
            let forward = new Ray(point, alongAxis)
            let backward = new Ray(point, alongAxis.scaledBy(-1))
            let intersection =
               forward.intersection(segment) || backward.intersection(segment)
            if (intersection) {
               let sqDistance = point.sqDistanceFrom(intersection)
               current = { segment, point: intersection, sqDistance }
            }
         } else {
            current = {
               segment,
               point: point.displacedBy(rejection),
               sqDistance: rejection.sqLength(),
            }
         }
         closest =
            current && (!closest || current.sqDistance < closest.sqDistance)
               ? current
               : closest
      }
      return closest
   }
   function closestProximalSegment(
      point: Point,
      alongAxis?: Axis,
      consider?: (s: Segment) => boolean
   ): { segment: Segment; point: Point } | undefined {
      let closest = closestSegment(point, alongAxis, consider)
      if (closest && isProximal(point, closest.point)) return closest
   }
   function closestCrossing(point: Point): Crossing | undefined {
      let closest: { crossing: Crossing; sqDistance: number } | undefined
      for (let [seg1, cs] of crossings) {
         for (let [seg2, p] of cs) {
            let current = {
               crossing: { seg1, seg2, point: p },
               sqDistance: p.sqDistanceFrom(point),
            }
            closest =
               !closest || current.sqDistance < closest.sqDistance
                  ? current
                  : closest
         }
      }
      return closest?.crossing
   }
   function closestProximalCrossing(point: Point): Crossing | undefined {
      let crossing = closestCrossing(point)
      if (crossing && isProximal(point, crossing.point)) return crossing
   }
   // Find the closest ruler to the given point (if any).
   // If "generatingPoint" is given, only consider rulers that are generated
   // by the given point (as defined elsewhere).
   function closestRuler(
      point: Point,
      consider?: (r: Ruler) => boolean
   ): { ruler: Ruler; point: Point } | undefined {
      let closest:
         | { ruler: Ruler; point: Point; sqDistance: number }
         | undefined
      for (let ruler of activeRulers) {
         if (consider && !consider(ruler)) continue
         let d = point.displacementFrom(ruler.line.origin)
         let rejection = d.projectionOnto(ruler.line.axis).sub(d)
         let current = {
            ruler,
            point: point.displacedBy(rejection),
            sqDistance: rejection.sqLength(),
         }
         closest =
            !closest || current.sqDistance < closest.sqDistance
               ? current
               : closest
      }
      return closest
   }
   type AttachPoint =
      | { object: Point; point: Point }
      | { object: Segment; point: Point }
      | { object: undefined }
   function closestAttachPoint(point: Point): AttachPoint {
      let endpoint = closestProximalEndpoint(point)
      if (endpoint) return { object: endpoint, point: endpoint }
      let s = closestProximalSegment(point)
      if (s) return { object: s.segment, point: s.point }
      return { object: undefined }
   }
   type ClickPoint = AttachPoint | { object: Crossing; point: Point }
   function closestClickPoint(point: Point): ClickPoint {
      let end = closestProximalEndpoint(point)
      let cross = closestProximalCrossing(point)
      if (end && cross) {
         if (cross.point.sqDistanceFrom(point) < end.sqDistanceFrom(point))
            end = undefined
      }
      if (end) return { object: end, point: end }
      if (cross) return { object: cross, point: cross.point }
      // let s = closestProximalSegment(point)
      // if (s) return { object: s.segment, point: s.point }
      return { object: undefined }
   }
   // --------------- State ---------------
   // The primary encoding of the circuit is an adjacency list. This supports
   // efficient graph traversals. The edges are are given stable identities as
   // Segment objects so that they can be referenced from other data structures.
   type OutgoingSegment = [Point, Segment]
   type Circuit = DefaultMap<Point, Set<OutgoingSegment>>
   let circuit: Circuit = new DefaultMap(() => new Set())
   let endpoints = () => circuit.keys()
   // For operations that only care about Segments, we store them directly.
   let segments: Set<Segment> = new Set()
   // We store the multiplicity of every axis in the circuit, so that if all
   // the segments aligned to a given axis are removed, the axis is forgotten.
   let circuitAxes: DefaultMap<Axis, number> = new DefaultMap(() => 0)
   // For each pair of segments, we store how their crossing should be rendered.
   type CrossingType = "H up" | "H down" | "V left" | "V right" | "no hop"
   let crossingTypes: DefaultMap<
      Segment,
      DefaultMap<Segment, CrossingType>
   > = new DefaultMap(() => new DefaultMap(() => "H up"))
   const crossingToggleOrder: CrossingType[] = [
      "H up",
      "H down",
      "V left",
      "V right",
      "no hop",
   ]
   // Because the presence of hopovers is independent of the circuit topology,
   // the circuit topology does not directly determine the SVG paths & lines
   // that need to be rendered. We compute the required SVG paths & lines below.
   type Crossing = { seg1: Segment; seg2: Segment; point: Point }
   let crossings: DefaultMap<Segment, Map<Segment, Point>>
   $: {
      crossings = new DefaultMap(() => new Map())
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
                  crossings.get0(seg1).set(seg2, crossPoint)
                  crossings.get0(seg2).set(seg1, crossPoint)
               }
            }
         }
      }
   }
   type Section = Segment
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
      | { type: "connection node"; point: Point }
      | { type: "endpoint marker"; point: Point }
   let glyphsToDraw: Set<Glyph>
   $: {
      segmentsToDraw = new Map()
      glyphsToDraw = new Set()
      for (let segment of segments) {
         // This array will collect the segment endpoints, and all of the
         // points at which the hopovers should be spliced into the segment.
         let points = [segment.start, segment.end]
         for (let [other, crossPoint] of crossings.get0(segment)) {
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
            let type = crossingTypes.get0(segment).get0(other)
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
               glyphsToDraw.add({ type: "endpoint marker", point: crossPoint })
            }
         }
         // Compute the sections that need to be drawn.
         let distanceOf = (p: Point) => p.sqDistanceFrom(segment.start)
         points.sort((a, b) => distanceOf(a) - distanceOf(b))
         let sections: Section[] = []
         for (let i = 0; i < points.length; i += 2) {
            sections.push(new Segment(points[i], points[i + 1], segment.axis))
         }
         segmentsToDraw.set(segment, sections)
      }
      // Determine the other glyphs that need to be drawn at endpoints.
      for (let [p, edges] of circuit) {
         if (edges.size > 2) {
            glyphsToDraw.add({ type: "connection node", point: p })
         } else if (straightAt(p) || highlighted.has(p) || selected.has(p)) {
            glyphsToDraw.add({ type: "endpoint marker", point: p })
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
   function straightAt(point: Point) {
      let edges = circuit.get0(point)
      if (edges.size !== 2) return false
      let axes = []
      for (let [_, { axis }] of edges) axes.push(axis)
      return axes[0] === axes[1]
   }
   function addSegment(segment: Segment) {
      circuit.get0(segment.start).add([segment.end, segment])
      circuit.get0(segment.end).add([segment.start, segment])
      segments.add(segment)
      circuitAxes.update(segment.axis, (c) => c + 1)
   }
   function deleteSegment(segment: Segment) {
      // Delete from "circuit"
      let startEdges = circuit.get0(segment.start)
      for (let edge of startEdges) {
         if (edge[1] === segment) {
            startEdges.delete(edge)
            if (startEdges.size === 0) circuit.delete(segment.start)
            break
         }
      }
      let endEdges = circuit.get0(segment.end)
      for (let edge of endEdges) {
         if (edge[1] === segment) {
            endEdges.delete(edge)
            if (endEdges.size === 0) circuit.delete(segment.end)
            break
         }
      }
      // Delete from "segments"
      segments.delete(segment)
      // Delete from "circuitAxes"
      let count = circuitAxes.get0(segment.axis)
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
   function deleteSelected() {
      let junctionsToConvert = new Set<Point>()
      for (let thing of selected) {
         if (thing instanceof Segment) {
            deleteSegment(thing)
            junctionsToConvert.add(thing.start)
            junctionsToConvert.add(thing.end)
         } else {
            for (let [_, segment] of circuit.get0(thing)) {
               deleteSegment(segment)
               junctionsToConvert.add(segment.start)
               junctionsToConvert.add(segment.end)
            }
         }
      }
      for (let junction of junctionsToConvert) {
         if (circuit.has(junction) && circuit.get0(junction).size === 2)
            convertToCrossing(junction)
      }
      selected = new ToggleSet()
   }
   function cutSegment(segment: Segment, cutPoint: Point) {
      let { start, end } = segment
      let axis = Axis.fromVector(start.displacementFrom(end))
      if (axis) {
         axis = findExistingAxis(axis)
         deleteSegment(segment)
         addSegment(new Segment(cutPoint, start, axis))
         addSegment(new Segment(cutPoint, end, axis))
      }
   }
   // If the junction is an X-junction, or a pair of colinear segments,
   // convert it into a crossing.
   function convertToCrossing(junction: Point) {
      let parts = partsOfJunction(junction)
      for (let segs of parts) {
         let fusedSegment = new Segment(
            junction === segs[0].start ? segs[0].end : segs[0].start,
            junction === segs[1].start ? segs[1].end : segs[1].start,
            segs[0].axis
         )
         deleteSegment(segs[0])
         deleteSegment(segs[1])
         addSegment(fusedSegment)
      }
   }
   function convertToJunction(crossing: Crossing) {
      cutSegment(crossing.seg1, crossing.point)
      cutSegment(crossing.seg2, crossing.point)
   }
   // If the junction is an X-junction, or a pair of colinear segments, return
   // each pair of colinear segments. Otherwise, return nothing.
   function partsOfJunction(junction: Point): Set<Segment[]> {
      let edges = circuit.get0(junction)
      if (edges.size !== 2 && edges.size !== 4) return new Set()
      let axes = new DefaultMap<Axis, OutgoingSegment[]>(() => [])
      for (let edge of edges) {
         axes.get0(edge[1].axis).push(edge)
      }
      let pairs = new Set<Segment[]>()
      for (let edgePair of axes.values()) {
         if (edgePair.length !== 2) return new Set()
         pairs.add([edgePair[0][1], edgePair[1][1]])
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
   function axesAtPoint(point: Point): Axis[] {
      let axes: Axis[] = []
      for (let [_, segment] of circuit.get0(point))
         if (!axes.includes(segment.axis)) axes.push(segment.axis)
      return axes
   }
   // Input state
   let mouse: Point = Point.zero
   let [shift, alt, cmd] = [false, false, false]
   let cursor: "auto" | "grab" | "grabbing" | "cell"
   $: {
      if (move) {
         cursor = "grabbing"
      } else {
         cursor = "auto"
         let attach = closestAttachPoint(mouse)
         if (
            tool === "select & move" &&
            attach.object &&
            !shift &&
            !alt &&
            !cmd
         ) {
            cursor = waitingForDrag ? "grabbing" : "grab"
         }
      }
   }
   let waitingForDrag: Point | null = null
   let highlighted: Set<Point | Segment>
   $: {
      highlighted = new Set()
      if (rectSelect) {
         highlighted = new Set(rectSelect.highlighted)
      } else if (bulkHighlighted.size > 0) {
         for (let s of bulkHighlighted) highlighted.add(s)
      } else if (tool === "select & move" && !move) {
         let attach = closestAttachPoint(mouse)
         if (attach.object) highlighted.add(attach.object)
      } else if (tool === "hydraulic line" && !move) {
         let click = closestClickPoint(mouse)
         if (click.object) {
            highlighted.add(click.point)
         } else {
            let s = closestProximalSegment(mouse)
            if (s) highlighted.add(s.segment)
         }
      }
   }
   let bulkHighlighted: Set<Segment>
   $: /* When activated, highlight all objects which are standardGap apart.*/ {
      if (cmd) {
         bulkHighlighted = new Set()
         let s = closestProximalSegment(mouse)
         if (s) {
            // Do bulk highlighting (and later, selection) along the axis
            // orthogonal to the segment's axis. To achieve this, we
            // re-coordinatize every object that has the same orientation as
            // the segment as an AABB, and search along the resultant y-axis.
            let selectAxis = s.segment.axis
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
                  seg.start.displacementFrom(Point.zero).subRotation(selectAxis)
               )
               let end = Point.zero.displacedBy(
                  seg.end.displacementFrom(Point.zero).subRotation(selectAxis)
               )
               let x = start.x <= end.x ? [start.x, end.x] : [end.x, start.x]
               let y = start.y <= end.y ? [start.y, end.y] : [end.y, start.y]
               info.set(seg, { segment: seg, x, y, visited: false })
            }
            let [front, back] =
               s.point.displacementFrom(mouse).subRotation(selectAxis).y > 0
                  ? [0, 1]
                  : [1, 0]
            bulkHighlighted.add(s.segment)
            let startInfo = info.get(s.segment) as SegmentInfo
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
   let selected: ToggleSet<Point | Segment> = new ToggleSet()
   function selectedPoints(): Set<Point> {
      let s = new Set<Point>()
      for (let thing of selected) {
         if (thing instanceof Point) {
            s.add(thing)
         } else {
            s.add(thing.start)
            s.add(thing.end)
         }
      }
      return s
   }
   let tool: "select & move" | "hydraulic line" = "hydraulic line"
   let draw: {
      mode: "strafing" | "fixed-axis rotation" | "free rotation"
      segment: Segment
      segmentIsNew: boolean
      endObject?: Point | Segment
   } | null = null
   let move: {
      points: Set<Point>
      locationGrabbed: Point
      axisGrabbed: Axis
      offset: Vector
      distance: number
      originalPositions: DefaultMap<Point, Point>
   } | null = null
   let rectSelect: {
      start: Point
      end: Point
      highlighted: Set<Point | Segment>
   } | null = null
   // Rulers that act as a visual indicator of snapping behaviour
   let activeRulers: Set<Ruler> = new Set()

   function beginDraw(start: Point, axis: Axis) {
      // Add the line being drawn to the circuit.
      let end = start.clone()
      let segment = new Segment(start, end, axis)
      addSegment(segment)
      draw = { mode: "strafing", segment, segmentIsNew: true }
      // Configure the endpoint of the line to be dragged as the mouse moves.
      selected = new ToggleSet([end])
      beginMove(end, end)
      // Create a ruler for each of the "standard" axes.
      let rulers: Set<Ruler> = new Set()
      for (let a of snapAxes) rulers.add(new Ruler(start, a, "ray"))
      // Create a ruler for each edge incident to the starting vertex (if any).
      if (circuit.has(start)) {
         for (let [_, seg] of circuit.get0(start)) {
            if (!snapAxes.includes(seg.axis)) {
               rulers.add(new Ruler(start, seg.axis, "ray"))
            }
         }
      }
      activeRulers = rulers
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
            let maybeAxis = Axis.fromVector(
               mouse.displacementFrom(draw.segment.start)
            )
            if (maybeAxis) {
               let newAxis = findExistingAxis(maybeAxis)
               // Snap to the nearest standard axis.
               let scores = snapAxes.map((axis) => Math.abs(newAxis.dot(axis)))
               newAxis = snapAxes[scores.indexOf(Math.max(...scores))]
               if (newAxis !== draw.segment.axis) {
                  deleteSegment(draw.segment)
                  beginDraw(draw.segment.start, newAxis)
                  draw.mode = "fixed-axis rotation"
                  if (move) move.offset = zeroVector
               }
            }
         } else if (draw.mode === "free rotation") {
            // To accommodate for the constantly-changing drawing axis, the draw
            // operation is restarted from scratch every update. (This is a bit
            // of a hack, but it's the simplest way to integrate "free
            // rotation" with the other drawing modes.)
            function isAcceptableTEMP(point: Point) {
               let start = draw!.segment.start
               let maybeAxis = Axis.fromVector(point.displacementFrom(start))
               if (!maybeAxis) return false
               let drawAxis = findExistingAxis(maybeAxis)
               for (let [other, { axis }] of circuit.get0(point)) {
                  // Reject if the segment being drawn would overlap this seg.
                  if (
                     axis === drawAxis &&
                     other.distanceFrom(start) + 1 <
                        point.distanceFrom(start) + other.distanceFrom(point)
                  )
                     return false
               }
               return true
            }
            let target = closestProximalEndpoint(mouse, isAcceptableTEMP)
            let maybeAxis = Axis.fromVector(
               (target ? target : mouse).displacementFrom(draw.segment.start)
            )
            if (maybeAxis) {
               let newAxis = findExistingAxis(maybeAxis)
               deleteSegment(draw.segment)
               beginDraw(draw.segment.start, newAxis)
               draw.mode = "free rotation"
               if (target) {
                  draw.segment.end.moveTo(target)
                  draw.endObject = target
               } else {
                  let s = closestProximalSegment(mouse, newAxis)
                  if (s) {
                     draw.segment.end.moveTo(s.point)
                     draw.endObject = s.segment
                  } else {
                     draw.segment.end.moveTo(mouse)
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
         for (let [other, s] of circuit.get0(draw!.segment.start)) {
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
         if (draw.endObject instanceof Point) {
            // Create a new Segment that ends at the Point.
            deleteSegment(segment)
            addSegment(new Segment(segment.start, draw.endObject, segment.axis))
         } else if (draw.endObject instanceof Segment) {
            // Turn the intersected Segment into a T-junction.
            cutSegment(draw.endObject, segment.end)
         }
      } else deleteSelected()
      // Reset the drawing state.
      if (draw.segmentIsNew) selected = new ToggleSet()
      draw = null
      activeRulers = new Set()
   }
   function beginMove(thingGrabbed: Point | Segment, pointGrabbed: Point) {
      // Find the Axis that the moved objects should snap along & orthogonal to.
      let axisGrabbed
      if (thingGrabbed instanceof Segment) {
         axisGrabbed = thingGrabbed.axis
      } else {
         let _
         let axis = Axis.horizontal
         for ([_, { axis }] of circuit.get0(thingGrabbed)) {
            // Prefer horizontal and vertical axes.
            if (axis === Axis.horizontal || axis === Axis.vertical) break
         }
         axisGrabbed = axis
      }
      // Make a copy of every Point in the circuit prior to movement.
      // We need to use these copies as a reference, because we will be
      // mutating the Point objects over the course of the movement.
      let originalPositions = new DefaultMap<Point, Point>(() => Point.zero)
      for (let point of endpoints()) {
         originalPositions.set(point, point.clone())
      }
      move = {
         points: selectedPoints(),
         locationGrabbed: pointGrabbed.clone(),
         axisGrabbed,
         offset: pointGrabbed.displacementFrom(mouse),
         distance: 0,
         originalPositions,
      }
      // If moving a single Point which is a loose end, treat the move
      // operation as a draw operation.
      if (!draw && move.points.size === 1) {
         for (let end of move.points) {
            let edges = circuit.get0(end)
            if (edges.size === 1) {
               for (let [start, existingSegment] of edges) {
                  // The existing segment may be backwards, so we should
                  // delete it and create a new one.
                  let newSegment = new Segment(start, end, existingSegment.axis)
                  deleteSegment(existingSegment)
                  addSegment(newSegment)
                  draw = {
                     mode: "strafing",
                     segment: newSegment,
                     segmentIsNew: false,
                  }
               }
            }
         }
      }
   }
   // ----- Compute the state of an in-progress move operation -----
   $: /* On a change to 'draw, 'move', or 'mouse' */ {
      if (move && draw?.mode !== "free rotation") {
         let drawingEdgeCase =
            draw && axesAtPoint(draw.segment.start).length !== 2
         // This is a "global variable" throughout the forthcoming operations.
         let moveInfo = new DefaultMap(() => {
            return {
               moveType: "no move" as "no move" | Axis | "full move",
               vector: zeroVector,
            }
         })
         // Firstly, perform a simple movement that tracks the mouse.
         let fullMove = mouse.displacementFrom(move.locationGrabbed)
         if (move.distance < 15) {
            fullMove = fullMove.add(
               move.offset.scaledBy(1 - move.distance / 15)
            )
         }
         if (draw && draw.mode === "fixed-axis rotation") {
            fullMove = fullMove.projectionOnto(draw.segment.axis)
            movePoint(draw.segment.end, fullMove)
         } else {
            doMove(fullMove)
         }
         let snappedToPoint = false
         if (draw && draw.mode === "strafing") {
            // Try snapping the moved endpoint to a nearby Point.
            function isAcceptableTEMP(point: Point) {
               if (moveInfo.get0(point).moveType !== "no move") return false
               let start = draw!.segment.start
               for (let [other, { axis }] of circuit.get0(point)) {
                  // Reject if the segment being drawn would overlap this seg.
                  if (
                     axis === draw!.segment.axis &&
                     other.distanceFrom(start) + 1 <
                        point.distanceFrom(start) + other.distanceFrom(point)
                  )
                     return false
               }
               return true
            }
            let target = closestProximalEndpoint(
               draw.segment.end,
               isAcceptableTEMP
            )
            if (target) {
               snappedToPoint = true
               let snappedMove = target.displacementFrom(move.locationGrabbed)
               doMove(snappedMove)
               draw.endObject = target
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
               movePoint(draw.segment.end, snappedMove)
            } else {
               doMove(snappedMove)
            }
            if (draw) {
               // Try snapping the endpoint to nearby segments.
               let s = closestProximalSegment(
                  draw.segment.end,
                  draw.segment.axis
               )
               if (s) {
                  draw.segment.end.moveTo(s.point)
                  draw.endObject = s.segment
               } else {
                  draw.endObject = undefined
               }
            }
         }

         function movePoint(p: Point, vector: Vector) {
            moveInfo.set(p, { moveType: "full move", vector })
            p.moveTo(move!.originalPositions.get0(p).displacedBy(vector))
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
            // Compute the movement of every Point in the circuit.
            moveInfo.clear()
            if (draw && drawingEdgeCase) {
               specialMove()
            } else if (draw) {
               // Try a normal move.
               for (let point of move!.points) {
                  propagateMovement(point, null, vector)
               }
               // If we weren't able to alter the length of the segment being
               // drawn, resort to a special move.
               if (moveInfo.get0(draw.segment.start).moveType === "full move") {
                  moveInfo.clear()
                  specialMove()
               }
            } else {
               // Do a normal move.
               for (let point of move!.points) {
                  propagateMovement(point, null, vector)
               }
            }
            // Update the position of each Point.
            for (let point of endpoints()) {
               point.moveTo(
                  move!.originalPositions
                     .get0(point)
                     .displacedBy(moveInfo.get0(point).vector)
               )
            }
            circuit = circuit
            segments = segments
         }
         function propagateMovement(
            currentPoint: Point, // The point we are moving.
            edgeAxis: Axis | null, // The axis of the edge we just followed.
            moveVector: Vector // The movement being propagated.
         ) {
            let current = moveInfo.get0(currentPoint)
            let axes = axesAtPoint(currentPoint)
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
            for (let [nextPoint, nextSegment] of circuit.get0(currentPoint)) {
               let nextEdgeAxis = nextSegment.axis
               let next = moveInfo.get0(nextPoint)
               let loneEdge = circuit.get0(nextPoint).size === 1
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
                  seg.start.displacementFrom(Point.zero).subRotation(snapAxis1)
               )
               let end = Point.zero.displacedBy(
                  seg.end.displacementFrom(Point.zero).subRotation(snapAxis1)
               )
               let s = moveInfo.get0(seg.start)
               let e = moveInfo.get0(seg.end)
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
            return new Vector(minXSnap, minYSnap).addRotation(snapAxis1)
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
         let x1 = Math.min(rectSelect.start.x, rectSelect.end.x)
         let x2 = Math.max(rectSelect.start.x, rectSelect.end.x)
         let y1 = Math.min(rectSelect.start.y, rectSelect.end.y)
         let y2 = Math.max(rectSelect.start.y, rectSelect.end.y)
         for (let [start, edges] of circuit) {
            function inRange(x: number, low: number, high: number) {
               return low <= x && x <= high
            }
            if (inRange(start.x, x1, x2) && inRange(start.y, y1, y2)) {
               let segmentAdded = false
               for (let [end, segment] of edges) {
                  if (inRange(end.x, x1, x2) && inRange(end.y, y1, y2)) {
                     rectSelect.highlighted.add(segment)
                     segmentAdded = true
                  }
               }
               if (!segmentAdded) {
                  rectSelect.highlighted.add(start)
               }
            }
         }
         // Don't highlight points if their segment is already selected.
         for (let thing of selected) {
            if (thing instanceof Segment) {
               rectSelect.highlighted.delete(thing.start)
               rectSelect.highlighted.delete(thing.end)
            }
         }
      }
   }
   function endRectSelect() {
      if (!rectSelect) return

      if (!shift && !alt) selected.clear()
      if (alt) for (let thing of rectSelect.highlighted) selected.delete(thing)
      else for (let thing of rectSelect.highlighted) selected.add(thing)

      selected = selected
      rectSelect = null
   }
   function shiftDown() {}
   function shiftUp() {}
   function altDown() {
      if (draw && move) {
         // Reset the reference information for the movement.
         move.locationGrabbed = draw.segment.end.clone()
         for (let point of move.originalPositions.keys()) {
            move.originalPositions.set(point, point.clone())
         }
      }
   }
   function altUp() {}
   function cmdDown() {}
   function cmdUp() {}
</script>

<svelte:window
   on:keydown={(event) => {
      switch (event.key) {
         case "s":
         case "S":
            tool = "select & move"
            break
         case "f":
         case "F":
            tool = "hydraulic line"
            selected = new ToggleSet()
            break
         case "Backspace":
         case "Delete": {
            deleteSelected()
            break
         }
         case "Shift":
            if (!shift) {
               shift = true
               shiftDown()
            }
            break
         case "Alt":
            if (!alt) {
               alt = true
               altDown()
            }
            break
         case "Control":
         case "Meta":
            if (!cmd) {
               cmd = true
               cmdDown()
            }
            break
      }
   }}
   on:keyup={(event) => {
      switch (event.key) {
         case "Shift":
            if (shift) {
               shift = false
               shiftUp()
            }
            break
         case "Alt":
            if (alt) {
               alt = false
               altUp()
            }
            break
         case "Control":
         case "Meta":
            if (cmd) {
               cmd = false
               cmdUp()
            }
            break
      }
   }}
   on:blur={(event) => {
      if (shift) {
         shift = false
         shiftUp()
      }
      if (alt) {
         alt = false
         altUp()
      }
      if (cmd) {
         cmd = false
         cmdUp()
      }
   }}
/>
<svg
   style="cursor: {cursor}"
   on:contextmenu={(event) => {
      // Disable the context menu.
      event.preventDefault()
      return false
   }}
   on:mousemove={(event) => {
      let newMouse = new Point(event.clientX, event.clientY)
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
                  let attach = closestAttachPoint(waitingForDrag)
                  if (attach.object) {
                     if (attach.object instanceof Segment)
                        cutSegment(attach.object, attach.point)
                     beginDraw(attach.point, drawAxis)
                  } else beginDraw(waitingForDrag, drawAxis)
                  waitingForDrag = null
               }
               break
         }
      }
   }}
   on:mousedown={(event) => {
      if (event.button === 0 /* Left mouse button */) {
         let clickPoint = new Point(event.clientX, event.clientY)
         switch (tool) {
            case "select & move": {
               let attach = closestAttachPoint(clickPoint)
               if (attach.object && !shift && !alt) {
                  if (cmd) {
                     selected.clear()
                     for (let s of bulkHighlighted) selected.add(s)
                  } else if (!selected.has(attach.object)) {
                     selected = new ToggleSet([attach.object])
                  }
                  beginMove(attach.object, attach.point)
               } else waitingForDrag = clickPoint
               break
            }
            case "hydraulic line":
               waitingForDrag = clickPoint
               break
         }
      }
   }}
   on:mouseup={(event) => {
      if (waitingForDrag) {
         waitingForDrag = null
         // A click happened.

         switch (tool) {
            case "select & move": {
               let attach = closestAttachPoint(mouse)
               if (!attach.object) selected.clear()
               else if (shift && cmd)
                  for (let s of bulkHighlighted) selected.add(s)
               else if (shift && !cmd) selected.toggle(attach.object)
               else if (alt && cmd)
                  for (let s of bulkHighlighted) selected.delete(s)
               else if (alt && !cmd) selected.delete(attach.object)
               else selected = new ToggleSet([attach.object])
               selected = selected
               break
            }
            case "hydraulic line": {
               let click = closestClickPoint(mouse)
               if (click.object instanceof Point) {
                  convertToCrossing(click.object)
               } else if (click.object instanceof Segment) {
                  // do nothing
               } else if (click.object /* instanceof Crossing */) {
                  // Change the crossing glyph.
                  let seg1 = click.object.seg1
                  let seg2 = click.object.seg2
                  let oldType = crossingTypes.get0(seg1).get0(seg2)
                  let i = crossingToggleOrder.indexOf(oldType) + 1
                  let newType
                  if (i < crossingToggleOrder.length) {
                     newType = crossingToggleOrder[i]
                     crossingTypes.get0(seg1).set(seg2, newType)
                     crossingTypes.get0(seg2).set(seg1, newType)
                     crossingTypes = crossingTypes
                  } else {
                     convertToJunction(click.object)
                  }
               }
               break
            }
         }
      } else {
         endDraw()
         endMove()
         endRectSelect()
      }
   }}
   on:mouseenter={(event) => {
      // If we're (re-)entering the window and the left mouse button isn't
      // down, cancel any drag-based operation that may be in progress.
      if ((event.buttons & 0b1) === 0) {
         draw = move = rectSelect = null
      }
   }}
>
   <!-- Bottom layer -->
   <g>
      <!-- {#each [...segments] as segment}
         {#if segment.end.sqDistanceFrom(segment.start) > 0.01}
            <Padding {segment} />
         {/if}
      {/each} -->
      <!-- {#if !(draw && alt)}
         {#each [...activeRulers] as ruler}
            <RulerHTML {ruler} />
         {/each}
      {/if} -->
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
   <!-- Symbol highlight & selection layer -->
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
         {:else if glyph.type === "connection node"}
            {#if selected.has(glyph.point)}
               <ConnectionPoint
                  renderType="selectLight"
                  position={glyph.point}
               />
            {:else if highlighted.has(glyph.point)}
               <ConnectionPoint renderType="highlight" position={glyph.point} />
            {/if}
         {:else if glyph.type === "endpoint marker"}
            {#if selected.has(glyph.point)}
               <EndpointMarker
                  renderType="selectLight"
                  position={glyph.point}
               />
            {:else if highlighted.has(glyph.point)}
               <EndpointMarker renderType="highlight" position={glyph.point} />
            {/if}
         {/if}
      {/each}
   </g>
   <!-- Symbol layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "hopover"}
            <Hopover start={glyph.start} end={glyph.end} flip={glyph.flip} />
         {:else if glyph.type === "connection node"}
            <ConnectionPoint position={glyph.point} />
         {:else if glyph.type === "endpoint marker"}
            <EndpointMarker position={glyph.point} />{/if}
      {/each}
   </g>
   <!-- HUD layer -->
   <g>
      <text class="toolText" x="8" y="24">{tool}</text>
      {#if rectSelect}
         <RectSelectBox start={rectSelect.start} end={rectSelect.end} />
      {/if}
   </g>
</svg>

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
   svg {
      width: 100%;
      height: 100%;
      /* shift the image so that 3px lines render without aliasing */
      transform: translate(-0.5px, -0.5px);
      background-color: rgb(193, 195, 199);
   }
   .toolText {
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
      font: 20px sans-serif;
   }
</style>
