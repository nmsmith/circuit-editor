<script lang="ts">
   import { Vector, Axis, Point, Line, Ray, Segment } from "./math"
   import { DefaultMap, ToggleSet } from "./utilities"
   import Wire from "./Wire.svelte"
   import Endpoint from "./Endpoint.svelte"
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
   function canSnap(source: Point, target: Point): boolean {
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
         let easeDir = target.displacementFrom(source).normalize()
         let distance = Math.sqrt(sqDistance)
         return {
            outcome: "eased",
            point: source.displaceBy(easeDir.scaleBy(easeFn(distance))),
         }
      } else return { outcome: "no easing", point: source }
   }
   // Find the closest endpoint to the given point (if any).
   function closestEndpoint(
      point: Point,
      consider?: (p: Point) => boolean
   ): Point | undefined {
      let closest: { point: Point; sqDistance: number } | undefined
      for (let p of circuit.keys()) {
         if (consider && !consider(p)) continue
         let current = { point: p, sqDistance: p.sqDistanceFrom(point) }
         closest =
            !closest || current.sqDistance < closest.sqDistance
               ? current
               : closest
      }
      return closest?.point
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
         let rejection = s.scaleBy(dot / sqLength).sub(p)
         let current
         if (alongAxis && rejection.sqLength() > 0.001) {
            let forward = new Ray(point, alongAxis)
            let backward = new Ray(point, alongAxis.scaleBy(-1))
            let intersection =
               forward.intersection(segment) || backward.intersection(segment)
            if (intersection) {
               let sqDistance = point.sqDistanceFrom(intersection)
               current = { segment, point: intersection, sqDistance }
            }
         } else {
            current = {
               segment,
               point: point.displaceBy(rejection),
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
            point: point.displaceBy(rejection),
            sqDistance: rejection.sqLength(),
         }
         closest =
            !closest || current.sqDistance < closest.sqDistance
               ? current
               : closest
      }
      return closest
   }
   type SnapResult =
      | { target: Point; point: Point; isSelected: boolean }
      | { target: Segment; point: Point; isSelected: boolean }
      | { target: undefined }
   function trySnapping(point: Point): SnapResult {
      let endpoint = closestEndpoint(point)
      if (endpoint && canSnap(point, endpoint)) {
         return {
            target: endpoint,
            point: endpoint,
            isSelected: selected.has(endpoint),
         }
      } else {
         let s = closestSegment(point)
         if (s && canSnap(point, s.point)) {
            return {
               target: s.segment,
               point: s.point,
               isSelected: selected.has(s.segment),
            }
         }
      }
      return { target: undefined }
   }
   // --------------- State ---------------
   // The primary encoding of the circuit is an adjacency list. This supports
   // efficient graph traversals. The edges are are given stable identities as
   // Segment objects so that they can be referenced from other data structures.
   type OutgoingSegment = [Point, Segment]
   type Circuit = DefaultMap<Point, Set<OutgoingSegment>>
   let circuit: Circuit = new DefaultMap(() => new Set())
   // For operations that only care about Segments, we store them directly.
   let segments: Set<Segment> = new Set()
   // We store the multiplicity of every axis in the circuit, so that if all
   // the segments aligned to a given axis are removed, the axis is forgotten.
   let circuitAxes: DefaultMap<Axis, number> = new DefaultMap(() => 0)

   function segmentExistsBetween(p1: Point, p2: Point) {
      if (!circuit.has(p1)) return false
      for (let [p] of circuit.get0(p1)) {
         if (p === p2) return true
      }
      return false
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
      circuit = circuit
      segments = segments
   }
   function deleteSelected() {
      let junctionsToFuse = new Set<Point>()
      for (let thing of selected) {
         if (thing instanceof Segment) {
            deleteSegment(thing)
            junctionsToFuse.add(thing.start)
            junctionsToFuse.add(thing.end)
         } else {
            for (let [_, segment] of circuit.get0(thing)) {
               deleteSegment(segment)
               junctionsToFuse.add(segment.start)
               junctionsToFuse.add(segment.end)
            }
         }
      }
      for (let junction of junctionsToFuse) {
         if (circuit.has(junction) && circuit.get0(junction).size === 2)
            fuseSegments(junction)
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
   // If the junction is an X-junction, or a pair of colinear segments, fuse
   // together each pair of colinear segments into a single segment.
   function fuseSegments(junction: Point) {
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
         let snap = trySnapping(mouse)
         if (
            tool === "select & move" &&
            snap.target &&
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
      if (draw) {
         if (draw.startObject) highlighted.add(draw.startObject)
         if (draw.endObject) highlighted.add(draw.endObject)
      } else if (rectSelect) {
         highlighted = new Set(rectSelect.highlighted)
      } else if (bulkHighlighted.size > 0) {
         for (let s of bulkHighlighted) highlighted.add(s)
      } else if (!move) {
         let snap = trySnapping(mouse)
         if (snap.target) highlighted.add(snap.target)
      }
   }
   let bulkHighlighted: Set<Segment>
   $: /* When activated, highlight all objects which are standardGap apart.*/ {
      if (cmd) {
         bulkHighlighted = new Set()
         let s = closestSegment(mouse)
         if (s && s.point.sqDistanceFrom(mouse) < sqSnapRadius) {
            // Do bulk highlighting (and later, selection) along the axis
            // orthogonal to the segment's axis. To achieve this, we
            // re-coordinatize every object that has the same orientation as
            // the segment as an AABB, and search along the resultant y-axis.
            let selectAxis = s.segment.axis
            let orthAxis = findExistingAxis(selectAxis.orthogonalAxis())
            type SegmentInfo = {
               segment: Segment
               x: number[]
               y: number[]
               visited: boolean
            }
            let info = new Map<Segment, SegmentInfo>()
            for (let seg of segments) {
               if (seg.axis !== selectAxis && seg.axis !== orthAxis) continue
               let start = Point.zero.displaceBy(
                  seg.start.displacementFrom(Point.zero).subRotation(selectAxis)
               )
               let end = Point.zero.displaceBy(
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
      segment: Segment
      segmentIsNew: boolean
      startObject?: Point | Segment
      endObject?: Point | Segment
   } | null = null
   let move: {
      points: Set<Point>
      grabLocation: Point
      grabbedAxis: Axis
      originalPositions: DefaultMap<Point, Point>
   } | null = null
   let rectSelect: {
      start: Point
      end: Point
      highlighted: Set<Point | Segment>
   } | null = null
   // Rulers that act as a visual indicator of snapping behaviour
   let activeRulers: Set<Ruler> = new Set()

   function beginDraw(start: Point, axis: Axis, startObject?: Point | Segment) {
      // Add the line being drawn to the circuit.
      let end = start.clone()
      let segment = new Segment(start, end, axis)
      addSegment(segment)
      if (startObject instanceof Segment) cutSegment(startObject, start)
      draw = { segment, segmentIsNew: true, startObject }
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
   function endDraw() {
      if (!draw) return
      endMove()
      let segment = draw.segment
      if (segment.sqLength() >= sqMinSegmentLength) {
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
   function beginMove(thingGrabbed: Point | Segment, grabLocation: Point) {
      // Find the Axis that the moved objects should snap along & orthogonal to.
      let grabbedAxis
      if (thingGrabbed instanceof Segment) {
         grabbedAxis = thingGrabbed.axis
      } else {
         let _
         let axis = Axis.horizontal
         for ([_, { axis }] of circuit.get0(thingGrabbed)) {
            // Prefer horizontal and vertical axes.
            if (axis === Axis.horizontal || axis === Axis.vertical) break
         }
         grabbedAxis = axis
      }
      // Make a copy of every Point in the circuit prior to movement.
      // We need to use these copies as a reference, because we will be
      // mutating the Point objects over the course of the movement.
      let originalPositions = new DefaultMap<Point, Point>(() => Point.zero)
      for (let point of circuit.keys()) {
         originalPositions.set(point, point.clone())
      }
      move = {
         points: selectedPoints(),
         grabLocation: grabLocation.clone(),
         grabbedAxis,
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
                     segment: newSegment,
                     segmentIsNew: false,
                     startObject: start,
                  }
               }
            }
         }
      }
   }
   // ----- Compute the state of an in-progress move operation -----
   $: /* On a change to 'draw, 'move', or 'mouse' */ {
      if (move) {
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
         let fullMove = mouse.displacementFrom(move.grabLocation)
         doMove(fullMove)
         // If we're drawing, try snapping the moved endpoint to a nearby Point.
         let snappedToPoint = false
         if (draw) {
            function isAcceptable(point: Point) {
               if (moveInfo.get0(point).moveType === "no move") {
                  for (let [other, { axis }] of circuit.get0(point)) {
                     if (axis === draw!.segment.axis) {
                        // Reject the point if the segment being drawn would
                        // overlap the edge being examined this iteration.
                        let dPoint = point.distanceFrom(draw!.segment.start)
                        let dOther = other.distanceFrom(draw!.segment.start)
                        if (dPoint > dOther) return false
                     }
                  }
                  return true
               } else return false
            }
            let target = closestEndpoint(draw.segment.end, isAcceptable)
            if (target && canSnap(draw.segment.end, target)) {
               snappedToPoint = true
               let snappedMove = target.displacementFrom(move.grabLocation)
               doMove(snappedMove)
               draw.endObject = target
            } else {
               draw.endObject = undefined
            }
         }
         if (!snappedToPoint) {
            // Snap axis-aligned objects to a "standardGap" distance apart.
            doMove(computeStandardGapSnap(fullMove))
            // If we're drawing, snap the endpoint to nearby segments.
            if (draw) {
               let s = closestSegment(draw.segment.end, draw.segment.axis)
               if (s && canSnap(draw.segment.end, s.point)) {
                  draw.segment.end.moveTo(s.point)
                  draw.endObject = s.segment
               } else {
                  draw.endObject = undefined
               }
            }
         }
         function doMove(vector: Vector) {
            moveInfo.clear()
            // Compute the movement of every Point in the circuit.
            if (draw && drawingEdgeCase) {
               moveInfo.set(draw.segment.end, { moveType: "full move", vector })
               propagateMovement(
                  draw.segment.start,
                  null,
                  vector.rejectionFrom(draw.segment.axis)
               )
            } else {
               for (let point of move!.points) {
                  propagateMovement(point, null, vector)
               }
            }
            // Update the position of each Point.
            for (let point of circuit.keys()) {
               point.moveTo(
                  move!.originalPositions
                     .get0(point)
                     .displaceBy(moveInfo.get0(point).vector)
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
            if (edgeAxis && axes.length == 2 && current.moveType == "no move") {
               // Keep only one component of the movement vector. This allows
               // parts of the circuit to stretch and contract as it is moved.
               current.moveType = edgeAxis
               let otherAxis = edgeAxis === axes[0] ? axes[1] : axes[0]
               // This is (part of) the formula for expressing a vector in
               // terms of a new basis. We express moveVector in terms of
               // (edgeAxis, otherAxis), but we only keep the 2nd component.
               current.vector = otherAxis.scaleBy(
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
         function computeStandardGapSnap(moveVector: Vector) {
            let snapAxis1 = move!.grabbedAxis
            let snapAxis2 = findExistingAxis(move!.grabbedAxis.orthogonalAxis())
            // To start with, compute relevant info about each segment.
            let snapInfo = new Map()
            for (let seg of segments) {
               let start = Point.zero.displaceBy(
                  seg.start.displacementFrom(Point.zero).subRotation(snapAxis1)
               )
               let end = Point.zero.displaceBy(
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
            return moveVector.add(
               new Vector(minXSnap, minYSnap).addRotation(snapAxis1)
            )
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
</script>

<svelte:window
   on:keydown={(event) => {
      shift = event.getModifierState("Shift")
      alt = event.getModifierState("Alt")
      cmd = event.getModifierState("Control") || event.getModifierState("Meta")
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
            deleteSelected()
            break
         }
      }
   }}
   on:keyup={(event) => {
      shift = event.getModifierState("Shift")
      alt = event.getModifierState("Alt")
      cmd = event.getModifierState("Control") || event.getModifierState("Meta")
   }}
   on:blur={(event) => {
      shift = alt = cmd = false
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
      mouse = new Point(event.clientX, event.clientY)
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
                  let scores = snapAxes.map((axis) => Math.abs(d.dot(axis)))
                  let drawAxis = snapAxes[scores.indexOf(Math.max(...scores))]
                  // let drawAxis = Math.abs(d.x) >= Math.abs(d.y)
                  //    ? Axis.horizontal
                  //    : Axis.vertical
                  let snap = trySnapping(waitingForDrag)
                  if (snap.target) {
                     beginDraw(snap.point, drawAxis, snap.target)
                  } else beginDraw(waitingForDrag, drawAxis, undefined)
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
               let snap = trySnapping(clickPoint)
               if (snap.target && !shift && !alt) {
                  if (cmd) {
                     selected.clear()
                     for (let s of bulkHighlighted) selected.add(s)
                  } else if (!snap.isSelected) {
                     selected = new ToggleSet([snap.target])
                  }
                  beginMove(snap.target, snap.point)
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
         let snap = trySnapping(mouse)
         switch (tool) {
            case "select & move":
               if (!snap.target) selected.clear()
               else if (shift && cmd)
                  for (let s of bulkHighlighted) selected.add(s)
               else if (shift && !cmd) selected.toggle(snap.target)
               else if (alt && cmd)
                  for (let s of bulkHighlighted) selected.delete(s)
               else if (alt && !cmd) selected.delete(snap.target)
               else selected = new ToggleSet([snap.target])
               selected = selected
               break
            case "hydraulic line":
               if (snap.target instanceof Point) fuseSegments(snap.target)
               break
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
   <g>
      <!-- Bottom layer -->
      {#each [...segments] as segment}
         {#if segment.end.sqDistanceFrom(segment.start) > 0.01}
            <Padding {segment} />
         {/if}
      {/each}
      <!-- {#if !(draw && alt)}
         {#each [...activeRulers] as ruler}
            <RulerHTML {ruler} />
         {/each}
      {/if} -->
   </g>
   <g>
      <!-- Middle layer -->
      {#each [...segments] as segment}
         <Wire
            {segment}
            highlighted={highlighted.has(segment)}
            selected={selected.has(segment)}
         />
         <Endpoint
            position={segment.start}
            highlighted={highlighted.has(segment.start)}
            selected={selected.has(segment.start)}
         />
         <Endpoint
            position={segment.end}
            highlighted={highlighted.has(segment.end)}
            selected={selected.has(segment.end)}
         />
      {/each}
   </g>
   <g>
      <text class="toolText" x="8" y="24">{tool}</text>
      <!-- Top layer -->
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
      fill: blue;
      stroke: blue;
      stroke-width: 0;
   }
   :global(.highlighted) {
      fill: rgb(0, 234, 255);
      stroke: rgb(0, 234, 255);
   }
   :global(.selected) {
      fill: yellow;
      stroke: yellow;
   }
   :global(.highlighted.selected) {
      fill: rgb(120, 255, 0);
      stroke: rgb(120, 255, 0);
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
