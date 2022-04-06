<script lang="ts">
   import { Vector, Point, Ray, Segment, Axis } from "./math"
   import { DefaultMap } from "./utilities"
   const tau = 2 * Math.PI
   // Snapping
   const sqMaxSnapDistance = 15 * 15
   const sqMinLengthToSnapToAxis = 2 * sqMaxSnapDistance
   const cosMinimumSnapAngle = Math.cos(tau / 25) // When snapping to a segment
   const snapAxes = [
      // Default axes used for snapping (ordered by priority)
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
         if (p.sqDistanceFrom(point) < sqMaxSnapDistance) return p
      }
      // Try snapping to points along the reference segment.
      if (reference) {
         for (let p of reference.segment.points(reference.length - 1)) {
            if (p.sqDistanceFrom(point) < sqMaxSnapDistance) return p
         }
      }
      return point
   }
   // Snap the point to a nearby axis of significance, if possible.
   // Otherwise, return the same point.
   function trySnappingToAxes(
      point: Point,
      startPoint: Point,
      snapAxes: Iterable<Axis>,
      sqMinLengthToSnap: number
   ): Point {
      const d = point.displacementFrom(startPoint)
      if (d.sqLength() >= sqMinLengthToSnap) {
         for (let axis of snapAxes) {
            const dp = d.projectionOnto(axis)
            const rejection = d.sub(dp)
            if (rejection.sqLength() < sqMaxSnapDistance) {
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
         // Use coordinates relative to one endpoint of the segment.
         let p = point.displacementFrom(start)
         let t = end.displacementFrom(start)
         let sqLength = t.sqLength()
         let dot = p.dot(t)
         // Only try snapping if the point's projection lies on the segment.
         // This occurs iff the dot product is in [0, lenSq].
         if (dot >= 0 && dot <= sqLength) {
            // Only snap if the point is sufficiently close to the segment.
            let projection = t.scaleBy(dot / sqLength)
            let rejection = p.sub(projection)
            if (rejection.sqLength() < sqMaxSnapDistance) {
               let target = new Segment(start, end)
               // If we have been given an axis to stretch along, and the
               // angle between the segment and the axis is not too narrow,
               // attempt to snap by stretching/contracting along that axis.
               if (stretchAxis) {
                  let cosAngle = t.dot(stretchAxis) / t.length()
                  if (Math.abs(cosAngle) <= cosMinimumSnapAngle) {
                     let forward = new Ray(point, stretchAxis)
                     let backward = new Ray(point, stretchAxis.scaleBy(-1))
                     let intersection =
                        forward.intersection(target) ||
                        backward.intersection(target)
                     if (intersection) {
                        return [intersection, target]
                     }
                  }
               } else {
                  // Otherwise, snap in the direction of the projection.
                  return [start.displaceBy(projection), target]
               }
            }
         }
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
   // The error ratio (between 0 and 1) at which two axes should be considered
   // parallel. This value has been chosen to approximately match when two
   // lines *look* parallel to the human eye. But it can also be set lower.
   // A non-zero tolerance is required to circumvent numerical error.
   const axisErrorTolerance = 0.004
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
   let drawStart: Point | null = null
   let drawEnd: Point | null = null
   let pointsGrabbed: Point[] = []
   let moveStart: Point | null = null
   let moveEnd: Point | null = null
   let moves: DefaultMap<Point, Vector>

   $: {
      if (drawStart) {
         // Try snapping to a point of significance.
         drawEnd = trySnappingToPoints(mouse)
         if (drawEnd === mouse) {
            // If no snapping occurred, try snapping to an angle and/or a
            // line segment instead.
            drawEnd = trySnappingToAxes(
               mouse,
               drawStart,
               snapAxes,
               sqMinLengthToSnapToAxis
            )
            ;[drawEnd] = trySnappingToSegments(
               drawEnd,
               Axis.fromVector(drawEnd.displacementFrom(drawStart))
            )
         }
      }
   }
   $: {
      moves = new DefaultMap(() => Vector.zero)
      if (moveStart) {
         // Snap the dragging to an axis if possible.
         function* axes() {
            //for (let axis of circuitAxes.keys()) yield axis
            for (let axis of snapAxes) yield axis
         }
         moveEnd = mouse //trySnappingToAxes(mouse, moveStart, axes(), 0)
         let moveVector = moveEnd.displacementFrom(moveStart)
         //let moveAxis = tryRoundingToExistingAxis(Axis.fromVector(moveVector))

         // Data we will need to maintain in the upcoming traversal.
         let pointData = new DefaultMap(() => {
            return {
               // Whether the point's movement has been determined yet.
               finalized: false as boolean | Axis,
               // Whether the point has only one edge.
               loneEdge: false,
               // If a Point's edges are aligned with exactly two Axes, we
               // treat the Axes as a vector basis, which we use to move points
               // according to a "rectangle resizing" algorithm.
               basis: null as null | Axis[],
               bannedAxis: null as null | Axis,
            }
         })
         // Gather some prerequisite data.
         for (let [point, edges] of circuitUndir) {
            let data = pointData.get(point)
            let possibleBasis: Axis[] = []
            for (let [_, axis] of edges) {
               if (!possibleBasis.includes(axis)) possibleBasis.push(axis)
            }
            if (edges.size === 1) data.loneEdge = true
            if (possibleBasis.length === 2) data.basis = possibleBasis
         }
         // Move each grabbed point.
         for (let point of pointsGrabbed) {
            propagateMovement(point, null)
         }
         function propagateMovement(
            currentPoint: Point, // The point we are moving.
            edgeAxis: Axis | null // The axis of the edge we just followed.
         ) {
            let current = pointData.get(currentPoint)
            let moveAlongAxis: Vector | null
            let moveLoneEdge: Vector
            if (current.basis && edgeAxis && edgeAxis !== current.bannedAxis) {
               // Move in accordance with "rectangle resizing".
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
               moves.set(currentPoint, movementAlongOtherAxis)
               current.finalized = edgeAxis
               moveAlongAxis = edgeAxis
               moveLoneEdge = movementAlongOtherAxis
               // edgeAxis is now the only axis we are "allowed" to
               // arrive at this point from. If we later arrive from the
               // other axis, we will resort to moving rigidly.
               current.bannedAxis = otherAxis
            } else {
               // Move rigidly.
               moves.set(currentPoint, moveVector)
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
                  moves.set(nextPoint, moveLoneEdge)
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
   function isDraw(event: MouseEvent) {
      // Left mouse button without the Shift key
      return event.button === 0 && !event.getModifierState("Shift")
   }
   function isMove(event: MouseEvent) {
      // Right mouse button, or left mouse button with the shift key
      return (
         event.button === 2 ||
         (event.button === 0 && event.getModifierState("Shift"))
      )
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

      if (isDraw(event)) {
         drawStart = trySnappingToPoints(clickPosition)
         if (drawStart === clickPosition) {
            ;[drawStart] = trySnappingToSegments(drawStart)
         }
      } else if (isMove(event)) {
         pointsGrabbed = []
         moveStart = trySnappingToPoints(clickPosition)
         if (moveStart === clickPosition) {
            let segment
            ;[moveStart, segment] = trySnappingToSegments(moveStart)
            if (segment) {
               pointsGrabbed.push(segment.start, segment.end)
            }
         } else {
            pointsGrabbed.push(moveStart)
         }
      }
   }}
   on:pointerup={(event) => {
      // Note: if drawStart or drawEnd have been chosen as the result of
      // snapping, then they will refer to existing Point objects. This is
      // crucial to ensuring that the circuit Maps and Sets accurately reflect
      // the circuit topology.
      if (isDraw(event) && drawStart && drawEnd) {
         if (drawStart !== drawEnd && !connected(drawStart, drawEnd)) {
            // Find the axis that the new edge aligns with.
            let newAxis = Axis.fromVector(drawEnd.displacementFrom(drawStart))
            let axis = tryRoundingToExistingAxis(newAxis)
            circuitAxes.update(axis, (c) => c + 1)
            // Update the directed circuit.
            circuitDir.get(drawStart).add([drawEnd, axis])
            circuitDir = circuitDir
            // Update the undirected circuit.
            circuitUndir.get(drawStart).add([drawEnd, axis])
            circuitUndir.get(drawEnd).add([drawStart, axis])
            circuitUndir = circuitUndir
         }
         // Reset the drawing state.
         drawStart = null
         drawEnd = null
      } else if (isMove(event) && moveStart && moveEnd) {
         // Commit the movement.
         for (let point of circuitUndir.keys()) {
            point.moveBy(moves.get(point))
         }
         moveStart = null
         moveEnd = null
      }
   }}
>
   <g>
      <!-- {#if moveStart && moveEnd}
         {#each pointsGrabbed as p}
            <line
               class="move"
               x1={p.x}
               y1={p.y}
               x2={p.x + moves.get(p).x}
               y2={p.y + moves.get(p).y}
            />
         {/each}
      {/if} -->
   </g>

   {#each [...circuitDir] as [start, edges]}
      {#each [...edges] as [end, _]}
         <line
            class="wire"
            x1={start.x + moves.get(start).x}
            y1={start.y + moves.get(start).y}
            x2={end.x + moves.get(end).x}
            y2={end.y + moves.get(end).y}
         />
         {#each [...new Segment(start, end).points(0)] as p}
            <circle cx={p.x + moves.get(p).x} cy={p.y + moves.get(p).y} r={4} />
         {/each}
      {/each}
   {/each}

   {#if drawStart && drawEnd}
      <line
         class="wire"
         x1={drawStart.x}
         y1={drawStart.y}
         x2={drawEnd.x}
         y2={drawEnd.y}
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
   .move {
      stroke: rgb(134, 186, 255);
      stroke-width: 2px;
   }
</style>
