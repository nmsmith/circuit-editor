<script lang="ts">
   import { Vector, Axis, Point, Line, Ray, Segment } from "./math"
   import { DefaultMap, ToggleSet } from "./utilities"
   import Wire from "./Wire.svelte"
   import Endpoint from "./Endpoint.svelte"
   import RulerHTML from "./Ruler.svelte"
   import { Ruler } from "./Ruler.svelte"
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
   const easeRadius = 30 // the distance at which easing begins
   const snapRadius = 15 // the distance at which snapping occurs
   const snapGap = 5 // the distance moved during the snap
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
   type EasingOutcome =
      | { outcome: "snapped"; point: Point }
      | { outcome: "eased"; point: Point }
      | { outcome: "no easing"; point: Point }
   function easeToTarget(source: Point, target?: Point): EasingOutcome {
      if (!target) return { outcome: "no easing", point: source }
      // Easing constants
      const a =
         (snapRadius - snapGap) /
         (sqSnapRadius + sqEaseRadius - 2 * snapRadius * easeRadius)
      const b = -2 * a * easeRadius
      const c = -a * sqEaseRadius - b * easeRadius

      let sqDistance = source.sqDistanceFrom(target)
      if (sqDistance < sqSnapRadius) {
         return { outcome: "snapped", point: target }
      } else if (sqDistance < sqEaseRadius) {
         let easeDir = target.displacementFrom(source).normalize()
         let x = Math.sqrt(sqDistance)
         return {
            outcome: "eased",
            point: source.displaceBy(easeDir.scaleBy(a * x * x + b * x + c)),
         }
      } else return { outcome: "no easing", point: source }
   }
   // Find the closest endpoint to the given point (if any).
   function closestEndpoint(point: Point): Point | undefined {
      let closest: { point: Point; sqDistance: number } | undefined
      for (let p of circuit.keys()) {
         let current = { point: p, sqDistance: p.sqDistanceFrom(point) }
         closest =
            !closest || current.sqDistance < closest.sqDistance
               ? current
               : closest
      }
      return closest?.point
   }
   // Find the closest ruler to the given point (if any).
   // If "generatingPoint" is given, only consider rulers that are generated
   // by the given point (as defined elsewhere).
   function closestRuler(
      point: Point,
      generatingPoint?: Point
   ): { ruler: Ruler; point: Point } | undefined {
      let closest:
         | { ruler: Ruler; point: Point; sqDistance: number }
         | undefined
      for (let ruler of activeRulers) {
         if (
            generatingPoint &&
            move?.rulerGenerators.get(ruler) !== generatingPoint
         )
            continue
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
   // Find the closest segment to the given point (if any).
   function closestSegment(
      point: Point,
      alongAxis?: Axis
   ): { segment: Segment; point: Point } | undefined {
      let closest:
         | { segment: Segment; point: Point; sqDistance: number }
         | undefined
      for (let segment of segments) {
         let p = point.displacementFrom(segment.start)
         let s = segment.end.displacementFrom(segment.start)
         let sqLength = s.sqLength()
         let dot = p.dot(s)
         // Only consider the segment if the point's projection lies on it.
         // This occurs iff the dot product is in [0, sqLength).
         if (dot < 0 || dot >= sqLength) continue
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

   function deleteSegment(segment: Segment): void {
      // Delete from "circuit"
      let startEdges = circuit.get(segment.start)
      for (let edge of startEdges) {
         if (edge[1] === segment) {
            startEdges.delete(edge)
            if (startEdges.size === 0) circuit.delete(segment.start)
            break
         }
      }
      let endEdges = circuit.get(segment.end)
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
      let count = circuitAxes.get(segment.axis)
      if (count > 1) {
         circuitAxes.set(segment.axis, count - 1)
      } else {
         circuitAxes.delete(segment.axis)
      }
      circuit = circuit
      segments = segments
   }
   function tryRoundingToExistingAxis(subject?: Axis): Axis | undefined {
      if (!subject) return
      for (let axis of snapAxes) {
         if (subject.approxEquals(axis, axisErrorTolerance)) return axis
      }
      for (let axis of circuitAxes.keys()) {
         if (subject.approxEquals(axis, axisErrorTolerance)) return axis
      }
      return subject
   }
   function connected(p1: Point, p2: Point) {
      if (!circuit.has(p1)) return false
      for (let [p] of circuit.get(p1)) {
         if (p === p2) return true
      }
      return false
   }
   // Input state
   let mouse: Point = Point.zero
   let cursor: "auto" | "grab" | "grabbing" | "cell"
   $: {
      if (move) {
         cursor = "grabbing"
      } else {
         cursor = "auto"
         let near: Point | Segment | undefined
         let point = closestEndpoint(mouse)
         if (point && canSnap(mouse, point)) {
            near = point
         } else {
            let s = closestSegment(mouse)
            if (s && canSnap(mouse, s.point)) {
               near = s.segment
            }
         }
         if (near) {
            if (selected.has(near)) {
               cursor = waitingForDrag ? "grabbing" : "grab"
            } else if (selected.size > 0) {
               cursor = "cell"
            }
         } else {
            cursor = "auto"
         }
      }
   }
   let waitingForDrag: Point | null = null
   let highlighted: Set<Point | Segment>
   $: {
      highlighted = new Set()
      if (draw) {
         if (!draw.startIsNew) highlighted.add(draw.start)
         if (!draw.endIsNew) highlighted.add(draw.end)
         if (draw.startSegment) highlighted.add(draw.startSegment)
         if (draw.endSegment) highlighted.add(draw.endSegment)
      } else if (rectSelect) {
         highlighted = new Set(rectSelect.highlighted)
      } else if (!move) {
         let endpoint = closestEndpoint(mouse)
         if (endpoint && canSnap(mouse, endpoint)) {
            highlighted.add(endpoint)
         } else {
            let s = closestSegment(mouse)
            if (s && canSnap(mouse, s.point)) {
               highlighted.add(s.segment)
            }
         }
      }
   }
   let selected: ToggleSet<Point | Segment> = new ToggleSet()
   let pointsToMove: Set<Point>
   $: {
      pointsToMove = new Set()
      for (let thing of selected) {
         if (thing instanceof Point) {
            pointsToMove.add(thing)
         } else {
            pointsToMove.add(thing.start)
            pointsToMove.add(thing.end)
         }
      }
   }
   let draw: {
      start: Point
      startIsNew: boolean
      startSegment?: Segment
      end: Point
      endIsNew: boolean
      endSegment?: Segment
      axis?: Axis
   } | null = null
   let move: {
      start: Point
      end: Point
      vectors: DefaultMap<Point, Vector>
      rulerGenerators: DefaultMap<Ruler, Point>
   } | null = null
   let rectSelect: {
      start: Point
      end: Point
      highlighted: Set<Point | Segment>
   } | null = null
   // Rulers that act as a visual indicator of snapping behaviour
   let activeRulers: Set<Ruler> = new Set()

   function beginDraw(start: Point, startSegment?: Segment) {
      draw = {
         start,
         startIsNew: !circuit.has(start),
         startSegment,
         end: start, // Updated elsewhere
         endIsNew: !circuit.has(start),
      }
      let r: Set<Ruler> = new Set()
      // Create a ruler for each of the "standard" axes.
      for (let axis of snapAxes) {
         r.add(new Ruler(draw.start, axis, "ray"))
      }
      // Create a ruler for each edge incident to the starting vertex (if any).
      if (circuit.has(draw.start)) {
         for (let [_, segment] of circuit.get(draw.start)) {
            if (!snapAxes.includes(segment.axis)) {
               r.add(new Ruler(draw.start, segment.axis, "ray"))
            }
         }
      }
      activeRulers = r
   }
   // ----- Compute the state of an in-progress draw operation -----
   $: /* On a change to 'draw' or 'mouse' */ {
      if (draw) {
         draw.endSegment = undefined
         let easeToEndpoint = easeToTarget(mouse, closestEndpoint(mouse))
         // Prioritize endpoint snapping over everything else.
         if (easeToEndpoint.outcome === "snapped") {
            draw.end = easeToEndpoint.point
            draw.endIsNew = false
            draw.axis = tryRoundingToExistingAxis(
               Axis.fromVector(draw.end.displacementFrom(draw.start))
            )
         } else {
            draw.end =
               // Ease out of zero length.
               mouse.sqDistanceFrom(draw.start) < sqEaseRadius
                  ? easeToTarget(mouse, draw.start).point
                  : easeToEndpoint.point
            let easeToRuler = easeToTarget(
               draw.end,
               closestRuler(draw.end)?.point
            )
            draw.end = easeToRuler.point
            let s =
               // If snapped to a ruler, ease along the ruler's axis.
               easeToRuler.outcome === "snapped"
                  ? closestSegment(
                       draw.end,
                       Axis.fromVector(draw.end.displacementFrom(draw.start))
                    )
                  : closestSegment(draw.end)
            if (s) {
               let ease = easeToTarget(draw.end, s.point)
               draw.end = ease.point
               if (ease.outcome === "snapped") draw.endSegment = s.segment
            }
            draw.endIsNew = true
            draw.axis = tryRoundingToExistingAxis(
               Axis.fromVector(draw.end.displacementFrom(draw.start))
            )
         }
         // Update the opacity of rulers.
         for (let ruler of activeRulers) ruler.setOpacity(draw.end)
         activeRulers = activeRulers // Tell Svelte the state has changed.
      }
   }
   function endDraw() {
      if (!draw) return
      if (
         draw.start.sqDistanceFrom(draw.end) >= sqMinSegmentLength &&
         draw.axis &&
         !connected(draw.start, draw.end) &&
         (!draw.startSegment ||
            (draw.startSegment !== draw.endSegment &&
               draw.startSegment.start !== draw.end &&
               draw.startSegment.end !== draw.end)) &&
         (!draw.endSegment ||
            (draw.endSegment.start !== draw.start &&
               draw.endSegment.end !== draw.start))
      ) {
         // Add the new segment
         let segment = new Segment(draw.start, draw.end, draw.axis)
         circuit.get(draw.start).add([draw.end, segment])
         circuit.get(draw.end).add([draw.start, segment])
         segments.add(segment)
         circuitAxes.update(draw.axis, (c) => c + 1)
         // Bifurcate existing segments if necessary
         if (draw.startSegment) bifurcate(draw.startSegment, draw.start)
         if (draw.endSegment) bifurcate(draw.endSegment, draw.end)
         function bifurcate(segment: Segment, bifurcationPoint: Point) {
            let { start, end } = segment
            let axis = tryRoundingToExistingAxis(
               Axis.fromVector(start.displacementFrom(end))
            )
            if (axis) {
               deleteSegment(segment)
               let segStart = new Segment(bifurcationPoint, start, axis)
               circuit.get(bifurcationPoint).add([start, segStart])
               circuit.get(start).add([bifurcationPoint, segStart])
               segments.add(segStart)
               let segEnd = new Segment(bifurcationPoint, end, axis)
               circuit.get(bifurcationPoint).add([end, segEnd])
               circuit.get(end).add([bifurcationPoint, segEnd])
               segments.add(segEnd)
               circuitAxes.update(axis, (c) => c + 2)
            }
         }
         // Let Svelte know the circuit has changed
         circuit = circuit
         segments = segments
      }
      // Reset the drawing state.
      draw = null
      activeRulers = new Set()
   }
   function beginMove(start: Point) {
      move = {
         start,
         // Updated elsewhere:
         end: start,
         vectors: new DefaultMap(() => zeroVector),
         rulerGenerators: new DefaultMap(() => Point.zero),
      }
      // Create the rulers relevant to this move operation.
      let rulersPerAxis: DefaultMap<Axis, Set<Ruler>> = new DefaultMap(
         () => new Set()
      )
      let axisIsCommon: DefaultMap<Axis, boolean> = new DefaultMap(() => true)
      for (let point of pointsToMove) {
         let axisIsStillCommon: DefaultMap<Axis, boolean> = new DefaultMap(
            () => false
         )
         let edges = circuit.get(point)
         for (let [origin, segment] of edges) {
            // Ignore axes that aren't common to all grabbed points.
            if (!axisIsCommon.get(segment.axis)) continue
            axisIsStillCommon.set(segment.axis, true)
            let rulersForAxis = rulersPerAxis.get(segment.axis)
            let rulerFound = false
            for (let ruler of rulersForAxis) {
               // Check if the two origins are on the same axis. If so,
               // we don't need a new ruler.
               let axisBetweenOrigins = tryRoundingToExistingAxis(
                  Axis.fromVector(ruler.line.origin.displacementFrom(origin))
               )
               if (axisBetweenOrigins === segment.axis) {
                  // Rulers that are needed by two or more points should
                  // be solid lines, rather than rays.
                  ruler.render = "line"
                  rulerFound = true
                  break
               }
            }
            if (!rulerFound) {
               let ruler
               if (edges.size > 1 && circuit.get(origin).size === 1) {
                  // Some edge-cases to make rendering less noisy.
                  ruler =
                     pointsToMove.size > 1
                        ? new Ruler(origin, segment.axis, "none")
                        : new Ruler(origin, segment.axis, "line")
               } else {
                  ruler = new Ruler(origin, segment.axis, "ray")
               }
               rulersForAxis.add(ruler)
               move.rulerGenerators.set(ruler, point)
            }
         }
         axisIsCommon = axisIsStillCommon
      }
      // Use these rulers.
      activeRulers = new Set()
      for (let [axis, rulersForAxis] of rulersPerAxis) {
         if (axisIsCommon.get(axis)) {
            for (let ruler of rulersForAxis) activeRulers.add(ruler)
         }
      }
   }
   // ----- Compute the state of an in-progress move operation -----
   $: /* On a change to 'move' or 'mouse' */ {
      if (move) {
         move.vectors = new DefaultMap(() => zeroVector)
         move.end =
            // Ease out of zero movement.
            mouse.sqDistanceFrom(move.start) < sqEaseRadius
               ? easeToTarget(mouse, move.start).point
               : mouse
         // Try easing one of the points being moved towards one of the rulers
         // it has generated. Then, shift move.end accordingly.
         let firstPoint: Point = Point.zero
         for (let point of pointsToMove) {
            firstPoint = point
            break
         }
         let d = firstPoint.displacementFrom(move.start)
         let m = move.end.displaceBy(d)
         move.end = easeToTarget(
            m,
            closestRuler(m, firstPoint)?.point
         ).point.displaceBy(d.scaleBy(-1))
         let moveVector = move.end.displacementFrom(move.start)

         // Data we will need to maintain in the upcoming traversal.
         let pointData = new DefaultMap(() => {
            return {
               // Whether the point's movement has been determined yet.
               finalized: false as boolean | Axis,
               // Whether the point has only one edge.
               loneEdge: null as null | OutgoingSegment,
               // If a Point's edges are aligned with exactly two Axes, we
               // treat the Axes as a vector basis, which we use to move points
               // according to a "rectangle/polygon resizing" algorithm.
               basis: null as null | Axis[],
               bannedAxis: null as null | Axis,
            }
         })
         // Gather some prerequisite data.
         for (let [point, edges] of circuit) {
            let axes: Axis[] = []
            let edge = null
            for (edge of edges) {
               let [_, segment] = edge
               if (!axes.includes(segment.axis)) axes.push(segment.axis)
            }
            if (edges.size === 1) pointData.get(point).loneEdge = edge
            else if (axes.length === 2) pointData.get(point).basis = axes
         }
         // If we're grabbing a point with only one edge, alter the move vector
         // so that the edge will be resized instead of "pushed".
         let grabbed0 = pointData.get(firstPoint)
         if (pointsToMove.size === 1 && grabbed0.loneEdge) {
            move.vectors.set(firstPoint, moveVector)
            grabbed0.finalized = true
            let [nextPoint, nextSegment] = grabbed0.loneEdge
            let nextAxis = nextSegment.axis
            // Only propagate the orthogonal component of the move vector.
            moveVector = moveVector.sub(moveVector.projectionOnto(nextAxis))
            propagateMovement(nextPoint, nextAxis)
         } else {
            // Move each grabbed point.
            for (let point of pointsToMove) {
               propagateMovement(point, null)
            }
         }
         // Update the opacity of rulers.
         for (let ruler of activeRulers) {
            let generator = move.rulerGenerators.get(ruler)
            let refPoint = generator.displaceBy(move.vectors.get(generator))
            ruler.setOpacity(refPoint)
         }
         activeRulers = activeRulers // Tell Svelte the state has changed.

         function propagateMovement(
            currentPoint: Point, // The point we are moving.
            edgeAxis: Axis | null // The axis of the edge we just followed.
         ) {
            let current = pointData.get(currentPoint)
            let moveAlongAxis: Vector | null
            let moveLoneEdge: Vector
            if (current.basis && edgeAxis && edgeAxis !== current.bannedAxis) {
               // Move in accordance with "rectangle/polygon resizing".
               let axis0 = current.basis[0]
               let axis1 = current.basis[1]
               let otherAxis = edgeAxis === axis0 ? axis1 : axis0
               // This is (part of) the formula for expressing a vector in
               // terms of a new basis. We need it to determine how the (x,y)
               // move vector can be expressed in terms of (edgeAxis,
               // otherAxis). This tells us which way the point needs to move.
               let movementAlongOtherAxis = otherAxis.scaleBy(
                  (edgeAxis.x * moveVector.y - edgeAxis.y * moveVector.x) /
                     (edgeAxis.x * otherAxis.y - edgeAxis.y * otherAxis.x)
               )
               move!.vectors.set(currentPoint, movementAlongOtherAxis)
               current.finalized = edgeAxis
               moveAlongAxis = edgeAxis
               moveLoneEdge = movementAlongOtherAxis
               // edgeAxis is now the only axis we are "allowed" to
               // arrive at this point from. If we later arrive from the
               // other axis, we will resort to moving rigidly.
               current.bannedAxis = otherAxis
            } else {
               // Move rigidly.
               move!.vectors.set(currentPoint, moveVector)
               current.finalized = true
               moveAlongAxis = null
               moveLoneEdge = moveVector
            }
            let nextEdges = circuit.get(currentPoint)
            for (let [nextPoint, nextSegment] of nextEdges) {
               let nextEdgeAxis = nextSegment.axis
               let next = pointData.get(nextPoint)
               if (next.finalized === true || next.finalized === nextEdgeAxis) {
                  continue
               } else if (next.loneEdge) {
                  move!.vectors.set(nextPoint, moveLoneEdge)
               } else if (
                  moveAlongAxis === null ||
                  moveAlongAxis === nextEdgeAxis
               ) {
                  propagateMovement(nextPoint, nextEdgeAxis)
               }
            }
         }
      }
   }
   function endMove() {
      if (!move) return
      // Commit the movement.
      for (let point of circuit.keys()) {
         point.moveBy(move.vectors.get(point))
      }
      move = null
      activeRulers = new Set()
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
      for (let thing of rectSelect.highlighted) selected.add(thing)
      selected = selected
      rectSelect = null
   }
</script>

<svelte:window
   on:keydown={(event) => {
      if (event.key === "Backspace" || event.key === "Delete") {
         for (let thing of selected) {
            if (thing instanceof Segment) deleteSegment(thing)
         }
         selected = new ToggleSet()
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
      mouse = new Point(event.clientX, event.clientY)
      // Check if the mouse has moved enough to trigger an action.
      if (waitingForDrag && mouse.sqDistanceFrom(waitingForDrag) > 16) {
         let endpoint = closestEndpoint(waitingForDrag)
         if (event.getModifierState("Shift")) {
            beginRectSelect(mouse)
         } else {
            if (endpoint && canSnap(waitingForDrag, endpoint)) {
               if (selected.has(endpoint)) {
                  beginMove(endpoint)
               } else if (selected.size === 0) {
                  beginDraw(endpoint)
               }
            } else {
               let s = closestSegment(waitingForDrag)
               if (s && canSnap(waitingForDrag, s.point)) {
                  if (selected.has(s.segment)) {
                     beginMove(s.point)
                  } else if (selected.size === 0) {
                     beginDraw(s.point, s.segment)
                  }
               } else {
                  selected = new ToggleSet()
                  beginDraw(waitingForDrag)
               }
            }
         }
         waitingForDrag = null
      }
   }}
   on:mousedown={(event) => {
      if (event.button === 0 /* Left mouse button */) {
         waitingForDrag = new Point(event.clientX, event.clientY)
      }
   }}
   on:mouseup={(event) => {
      if (waitingForDrag) {
         waitingForDrag = null
         // A click happened.
         let endpoint = closestEndpoint(mouse)
         if (endpoint && canSnap(mouse, endpoint)) {
            selected.toggle(endpoint)
         } else {
            let s = closestSegment(mouse)
            if (s && canSnap(mouse, s.point)) {
               selected.toggle(s.segment)
            } else {
               selected.clear()
            }
         }
         selected = selected
      } else {
         endDraw()
         endMove()
         endRectSelect()
      }
   }}
>
   <!-- <defs>
      <filter id="blur" filterUnits="userSpaceOnUse">
         <feGaussianBlur stdDeviation="3" />
      </filter>
      <filter id="shadow" filterUnits="userSpaceOnUse">
         <feOffset result="offOut" in="SourceAlpha" dx="2" dy="2" />
         <feGaussianBlur stdDeviation="2" />
      </filter>
   </defs> -->
   <g>
      <!-- Bottom layer -->
      {#each [...activeRulers] as ruler}
         <RulerHTML {ruler} />
      {/each}
   </g>
   <g>
      <!-- Middle layer -->
      {#each [...segments] as segment}
         {@const start = move
            ? segment.start.displaceBy(move.vectors.get(segment.start))
            : segment.start}
         {@const end = move
            ? segment.end.displaceBy(move.vectors.get(segment.end))
            : segment.end}
         <Wire
            {start}
            {end}
            highlighted={highlighted.has(segment)}
            selected={selected.has(segment)}
         />
         <Endpoint
            position={start}
            highlighted={highlighted.has(segment.start)}
            selected={selected.has(segment.start)}
         />
         <Endpoint
            position={end}
            highlighted={highlighted.has(segment.end)}
            selected={selected.has(segment.end)}
         />
      {/each}

      {#if draw}
         <Wire start={draw.start} end={draw.end} />
         <Endpoint
            position={draw.start}
            highlighted={highlighted.has(draw.start)}
         />
         <Endpoint
            position={draw.end}
            highlighted={highlighted.has(draw.end)}
         />
      {/if}
   </g>
   <g>
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
      /* filter: url(#blur); */
   }
   /* :global(.shadow) {
      fill: rgba(0, 0, 0, 0.6);
      stroke: rgba(0, 0, 0, 0.6);
      filter: url(#shadow);
   } */
   svg {
      width: 100%;
      height: 100%;
      /* shift the image so that 3px lines render without aliasing */
      transform: translate(-0.5px, -0.5px);
      background-color: rgb(193, 195, 199);
   }
</style>
