<script lang="ts">
   import { Vector, Point, Ray, Segment, Axis } from "./math"
   import { DefaultMap } from "./utilities"
   // Math constants
   const tau = 2 * Math.PI
   // Configurable constants
   const minimumSegmentLength = 20
   // The error ratio (between 0 and 1) at which two axes should be considered
   // parallel. A non-zero tolerance is required to circumvent numerical error.
   const axisErrorTolerance = 0.004
   // Snapping constants
   const maxSnapDistance = 15
   const sqMaxSnapDistance = maxSnapDistance * maxSnapDistance
   const sqMinLengthToSnapToAxis = 2 * sqMaxSnapDistance
   const cosMinimumSnapAngle = Math.cos(tau / 25) // When snapping to a segment
   // Ruler constants
   const rulerOpaqueDistance = maxSnapDistance // Max distance at which opaque
   const rulerTransparentDistance = 60 // Min distance at which transparent
   const rulerTransparencyTaper = rulerTransparentDistance * Math.SQRT2
   // The default axes used for snapping (ordered by priority)
   const snapAxes = [
      Axis.horizontal,
      Axis.vertical,
      Axis.fromAngle(0.125 * tau), // 45 degrees
      Axis.fromAngle(0.375 * tau), // 135 degrees
   ]
   // Snap the point to a nearby point of significance, if possible.
   // Otherwise, return the same point.
   function trySnappingToPoints(point: Point): Point {
      // Try snapping to segment endpoints.
      for (let p of circuitUndir.keys()) {
         if (p === draw?.start) continue
         if (p.sqDistanceFrom(point) <= sqMaxSnapDistance) return p
      }
      // Try snapping to points along the reference segment.
      if (reference) {
         for (let p of reference.segment.points(reference.length - 1)) {
            if (p === draw?.start) continue
            if (p.sqDistanceFrom(point) <= sqMaxSnapDistance) return p
         }
      }
      return point
   }
   // Snap the point to a nearby axis of significance, if possible.
   // Otherwise, return the same point.
   function trySnappingToAxes(
      point: Point,
      startPoint: Point,
      snapAxes: Iterable<Axis>
   ): Point {
      const d = point.displacementFrom(startPoint)
      if (d.sqLength() >= sqMinLengthToSnapToAxis) {
         for (let axis of snapAxes) {
            const dp = d.projectionOnto(axis)
            const rejection = d.sub(dp)
            if (rejection.sqLength() <= sqMaxSnapDistance) {
               return startPoint.displaceBy(dp)
            }
         }
      }
      return point
   }
   // Snap the point to a nearby line segment, if possible.
   // Otherwise, return the same point.
   function trySnappingToSegments(
      point: Point,
      stretchAxis?: Axis
   ): [Point, Segment | null] {
      for (let [start, end] of segments()) {
         if (start === draw?.start || end === draw?.start) continue
         // Use coordinates relative to one endpoint of the segment.
         let p = point.displacementFrom(start)
         let t = end.displacementFrom(start)
         let sqLength = t.sqLength()
         let dot = p.dot(t)
         // Only try snapping if the point's projection lies on the segment.
         // This occurs iff the dot product is in [0, lenSq].
         if (dot < 0 || dot > sqLength) continue
         // Only snap if the point is sufficiently close to the segment.
         let projection = t.scaleBy(dot / sqLength)
         let rejection = p.sub(projection)
         if (rejection.sqLength() > sqMaxSnapDistance) continue
         // If we have been given an axis, attempt to snap by stretching along
         // that axis. Otherwise, snap in the direction of the projection.
         let target = new Segment(start, end)
         if (stretchAxis) {
            // Only snap if the angle is not too narrow.
            let cosAngle = t.dot(stretchAxis) / t.length()
            if (Math.abs(cosAngle) > cosMinimumSnapAngle) continue
            let forward = new Ray(point, stretchAxis)
            let backward = new Ray(point, stretchAxis.scaleBy(-1))
            let intersection =
               forward.intersection(target) || backward.intersection(target)
            if (intersection) return [intersection, target]
         } else return [start.displaceBy(projection), target]
      }
      return [point, null]
   }

   // --------------- State ---------------
   // The circuit is stored as an adjacency list to enable efficient graph
   // traversals. We store the circuit twice. The first encoding is directed,
   // so every edge is only stored once. This is necessary for some operations.
   // The second encoding is undirected, so every edge is stored twice. This
   // is necessary for graph traversal operations. Also, some operations need
   // to know the Axis that an edge aligns with, so we record that too.
   type EdgeOut = [Point, Axis]
   type Circuit = DefaultMap<Point, Set<EdgeOut>>
   let circuitDir: Circuit = new DefaultMap(() => new Set())
   let circuitUndir: Circuit = new DefaultMap(() => new Set())
   // Store the multiplicity of every axis in the circuit, so that if all the
   // edges aligned to a given axis are removed, the axis is forgotten.
   let circuitAxes: DefaultMap<Axis, number> = new DefaultMap(() => 0)

   function tryRoundingToExistingAxis(subject: Axis): Axis {
      for (let axis of snapAxes) {
         if (subject.approxEquals(axis, axisErrorTolerance)) return axis
      }
      for (let [axis, _] of circuitAxes) {
         if (subject.approxEquals(axis, axisErrorTolerance)) return axis
      }
      return subject
   }
   function* segments(): Generator<[Point, Point]> {
      for (let [start, edges] of circuitDir) {
         for (let [end, _] of edges) {
            yield [start, end]
         }
      }
   }
   function connected(p1: Point, p2: Point) {
      for (let [p, _] of circuitUndir.get(p1)) {
         if (p === p2) return true
      }
      return false
   }
   let segmentUnderMouse: Segment | null
   // The segment that defines the current metric used for drawing
   let reference: { segment: Segment; length: number } | null = null
   // Input state
   let mouse: Point = Point.zero
   let draw: { start: Point; end: Point; axis: Axis } | null = null
   let move: {
      start: Point
      end: Point
      vectors: DefaultMap<Point, Vector>
   } | null = null
   let pointsGrabbed: Point[] = []
   // Aids that indicate snap locations and axis alignment
   type Ruler = { start: Point; end: Point; opacity: number }
   let rulers: Ruler[] = []
   let rulerTicks: Point[] = []

   // ----- Compute the endpoint of the line being drawn -----
   $: {
      if (draw) {
         // Try snapping to a point of significance.
         draw.end = trySnappingToPoints(mouse)
         if (draw.end === mouse) {
            // If no snapping occurred, try snapping to an angle and/or a
            // line segment instead.
            function* axes() {
               if (circuitUndir.has(draw!.start)) {
                  for (let [_, axis] of circuitUndir.get(draw!.start)) {
                     yield axis
                  }
               }
               for (let axis of snapAxes) yield axis
            }
            draw.end = trySnappingToAxes(mouse, draw.start, axes())
            draw.axis = tryRoundingToExistingAxis(
               Axis.fromVector(draw.end.displacementFrom(draw.start))
            )
            ;[draw.end] = trySnappingToSegments(draw.end, draw.axis)
         }
      }
   }
   // ----- Compute the rulers associated with the line being drawn -----
   $: {
      rulers = []
      if (draw) {
         // Draw a ruler for each of the "standard" axes.
         for (let axis of snapAxes) {
            addRuler(draw.start, draw.end, axis)
            addRuler(draw.start, draw.end, axis.scaleBy(-1))
         }
         // Draw a ruler for each edge incident to this point.
         if (circuitUndir.has(draw.start)) {
            for (let [point, axis] of circuitUndir.get(draw.start)) {
               if (!snapAxes.includes(axis)) {
                  addRuler(draw.start, draw.end, axis)
                  addRuler(draw.start, draw.end, axis.scaleBy(-1))
               }
            }
         }
         function addRuler(dragStart: Point, dragEnd: Point, axis: Axis) {
            let distance = new Ray(dragStart, axis).distanceFrom(dragEnd)
            // Taper the opacity at small drag distances.
            let dragDistance = dragEnd.distanceFrom(dragStart)
            let taper = Math.min(dragDistance / rulerTransparencyTaper, 1)
            const od = taper * rulerOpaqueDistance
            const td = taper * rulerTransparentDistance
            let opacity =
               taper === 0 ? 0 : taper * (1 - (distance - od) / (td - od))
            let end = dragStart.displaceBy(axis.scaleBy(4000)) // Hack.
            if (opacity > 0) {
               rulers.push({ start: dragStart, end, opacity })
            }
         }
      }
   }
   // ----- Compute the endpoint of the move operation underway -----
   $: {
      if (move) {
         // Snap the dragging to an axis if possible.
         function* axes() {
            //for (let axis of circuitAxes.keys()) yield axis
            for (let axis of snapAxes) yield axis
         }
         move.end = trySnappingToAxes(mouse, move.start, axes())
         move.vectors = new DefaultMap(() => Vector.zero)
         let moveVector = move.end.displacementFrom(move.start)

         // Data we will need to maintain in the upcoming traversal.
         let pointData = new DefaultMap(() => {
            return {
               // Whether the point's movement has been determined yet.
               finalized: false as boolean | Axis,
               // Whether the point has only one edge.
               loneEdge: null as null | EdgeOut,
               // If a Point's edges are aligned with exactly two Axes, we
               // treat the Axes as a vector basis, which we use to move points
               // according to a "rectangle/polygon resizing" algorithm.
               basis: null as null | Axis[],
               bannedAxis: null as null | Axis,
            }
         })
         // Gather some prerequisite data.
         for (let [point, edges] of circuitUndir) {
            let axes: Axis[] = []
            let edge = null
            for (edge of edges) {
               let [_, axis] = edge
               if (!axes.includes(axis)) axes.push(axis)
            }
            if (edges.size === 1) pointData.get(point).loneEdge = edge
            else if (axes.length === 2) pointData.get(point).basis = axes
         }
         // If we're grabbing a point with only one edge, alter the move vector
         // so that the edge will be resized instead of "pushed".
         let grabbed0 = pointData.get(pointsGrabbed[0])
         if (pointsGrabbed.length === 1 && grabbed0.loneEdge) {
            move.vectors.set(pointsGrabbed[0], moveVector)
            grabbed0.finalized = true
            let [nextPoint, nextAxis] = grabbed0.loneEdge
            // Only propagate the orthogonal component of the move vector.
            moveVector = moveVector.sub(moveVector.projectionOnto(nextAxis))
            propagateMovement(nextPoint, nextAxis)
         } else {
            // Move each grabbed point.
            for (let point of pointsGrabbed) {
               propagateMovement(point, null)
            }
         }
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
            let nextEdges = circuitUndir.get(currentPoint)
            for (let [nextPoint, nextEdgeAxis] of nextEdges) {
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
   function isDrawStart(event: MouseEvent) {
      // Left mouse button without the Shift key
      return event.button === 0 && !event.getModifierState("Shift")
   }
   function isDrawEnd(event: MouseEvent) {
      return event.button === 0
   }
   function isMoveStart(event: MouseEvent) {
      // Right mouse button, or left mouse button with the shift key
      return (
         event.button === 2 ||
         (event.button === 0 && event.getModifierState("Shift"))
      )
   }
   function isMoveEnd(event: MouseEvent) {
      return event.button === 0 || event.button === 2
   }
</script>

<svg
   on:contextmenu={(event) => {
      // Disable the context menu.
      event.preventDefault()
      return false
   }}
   on:pointermove={(event) => {
      mouse = new Point(event.clientX, event.clientY)
   }}
   on:pointerdown={(event) => {
      let clickPosition = new Point(event.clientX, event.clientY)

      if (isDrawStart(event)) {
         draw = { start: clickPosition, end: clickPosition, axis: Axis.zero }
         draw.start = trySnappingToPoints(clickPosition)
         if (draw.start === clickPosition) {
            ;[draw.start] = trySnappingToSegments(draw.start)
         }
      } else if (isMoveStart(event)) {
         move = {
            start: clickPosition,
            end: clickPosition,
            vectors: new DefaultMap(() => Vector.zero),
         }
         pointsGrabbed = []
         move.start = trySnappingToPoints(clickPosition)
         if (move.start === clickPosition) {
            let segment
            ;[move.start, segment] = trySnappingToSegments(move.start)
            if (segment) {
               pointsGrabbed.push(segment.start, segment.end)
            }
         } else {
            pointsGrabbed.push(move.start)
         }
      }
   }}
   on:pointerup={(event) => {
      // Note: if draw.start or draw.end have been chosen as the result of
      // snapping, then they will refer to existing Point objects. This is
      // crucial to ensuring that the circuit Maps and Sets accurately reflect
      // the circuit topology.
      if (isDrawEnd(event) && draw) {
         if (
            draw.start.distanceFrom(draw.end) >= minimumSegmentLength &&
            !connected(draw.start, draw.end)
         ) {
            circuitAxes.update(draw.axis, (c) => c + 1)
            // Update the directed circuit.
            circuitDir.get(draw.start).add([draw.end, draw.axis])
            circuitDir = circuitDir
            // Update the undirected circuit.
            circuitUndir.get(draw.start).add([draw.end, draw.axis])
            circuitUndir.get(draw.end).add([draw.start, draw.axis])
            circuitUndir = circuitUndir
         }
         // Reset the drawing state.
         draw = null
      } else if (isMoveEnd(event) && move) {
         // Commit the movement.
         for (let point of circuitUndir.keys()) {
            point.moveBy(move.vectors.get(point))
         }
         move = null
      }
   }}
>
   <g>
      {#each rulers as ruler}
         <line
            class="ruler"
            x1={ruler.start.x}
            y1={ruler.start.y}
            x2={ruler.end.x}
            y2={ruler.end.y}
            opacity={ruler.opacity}
         />
      {/each}
   </g>

   {#each [...circuitDir] as [st, edges]}
      {#each [...edges] as [end, _]}
         {#if move}
            <line
               class="wire"
               x1={st.x + move.vectors.get(st).x}
               y1={st.y + move.vectors.get(st).y}
               x2={end.x + move.vectors.get(end).x}
               y2={end.y + move.vectors.get(end).y}
            />
            {#each [...new Segment(st, end).points(0)] as p}
               <circle
                  cx={p.x + move.vectors.get(p).x}
                  cy={p.y + move.vectors.get(p).y}
                  r={4}
               />
            {/each}
         {:else}
            <line class="wire" x1={st.x} y1={st.y} x2={end.x} y2={end.y} />
            {#each [...new Segment(st, end).points(0)] as p}
               <circle cx={p.x} cy={p.y} r={4} />
            {/each}
         {/if}
      {/each}
   {/each}

   {#if draw}
      <line
         class="wire"
         x1={draw.start.x}
         y1={draw.start.y}
         x2={draw.end.x}
         y2={draw.end.y}
      />
   {/if}
</svg>

<style>
   :global(html, body, #app) {
      height: 100%;
      margin: 0px;
   }
   svg {
      width: 100%;
      height: 100%;
      fill: green;
   }
   circle {
      fill: black;
   }
   .wire {
      stroke: rgb(106, 2, 167);
      stroke-width: 2px;
   }
   .ruler {
      stroke: rgb(225, 225, 225);
      stroke-width: 6px;
   }
</style>
