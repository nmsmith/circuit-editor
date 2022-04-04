<script lang="ts">
   import { Vec, Point, Ray, Segment } from "./math"
   import { DefaultMap } from "./utilities"
   // Angle constants
   const tau = 2 * Math.PI
   // Snapping
   const sqMaxSnapDistance = 15 * 15
   const sqMinLengthToSnapToDir = 2 * sqMaxSnapDistance
   const cosMinimumSnapAngle = Math.cos(tau / 25) // When snapping to a segment
   const snapAngles = [
      // Angles used when snapping to an angle (ordered by priority)
      0,
      0.25 * tau,
      0.5 * tau,
      0.75 * tau,
      0.125 * tau,
      0.375 * tau,
      0.625 * tau,
      0.875 * tau,
   ]
   const snapDirections = snapAngles.map((a) => {
      return new Vec(Math.cos(a), Math.sin(a))
   })

   // Snap the point to a significant point in the scene, if possible.
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
   // Snap the point to a nearby direction, if possible.
   // Otherwise, return the same point.
   function trySnappingToDirections(
      point: Point,
      startPoint: Point,
      snapDirs: Iterable<Vec>,
      sqMinLengthToSnap: number
   ): Point {
      const dir = point.displacementFrom(startPoint)
      if (dir.sqLength() >= sqMinLengthToSnap) {
         for (let dirSnap of snapDirs) {
            const dirProjected = dir.projectionOnto(dirSnap)
            const rejection = dir.sub(dirProjected)
            if (rejection.sqLength() < sqMaxSnapDistance) {
               return startPoint.displaceBy(dirProjected)
            }
         }
      }
      return point
   }
   // Snap the point to a nearby line segment, if possible.
   // Otherwise, return the same point.
   function trySnappingToSegments(
      point: Point,
      snapDirection?: Vec // If empty, we will just project onto the segment.
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
               // If we have been given a snap direction, and the angle
               // between the segment and the snap direction is not too
               // narrow, attempt to snap to that direction.
               if (snapDirection) {
                  let cosAngle =
                     t.dot(snapDirection) /
                     (t.length() * snapDirection.length())
                  if (Math.abs(cosAngle) <= cosMinimumSnapAngle) {
                     let forward = new Ray(point, snapDirection)
                     let backward = new Ray(point, snapDirection.scaleBy(-1))

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
   // is necessary for graph traversal operations.
   let circuitDir: DefaultMap<Point, Set<Point>> = new DefaultMap(
      () => new Set()
   )
   let circuitUndir: DefaultMap<Point, Set<Point>> = new DefaultMap(
      () => new Set()
   )
   function* segments() {
      for (let [start, ends] of circuitDir) {
         for (let end of ends) {
            yield [start, end]
         }
      }
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
   let moves: DefaultMap<Point, Vec>

   $: {
      if (drawStart) {
         // Try snapping to a point of significance.
         drawEnd = trySnappingToPoints(mouse)
         if (drawEnd === mouse) {
            // If no snapping occurred, try snapping to an angle and/or a
            // line segment instead.
            drawEnd = trySnappingToDirections(
               mouse,
               drawStart,
               snapDirections,
               sqMinLengthToSnapToDir
            )
            ;[drawEnd] = trySnappingToSegments(
               drawEnd,
               drawEnd.displacementFrom(drawStart)
            )
         }
      }
   }
   $: {
      moves = new DefaultMap(() => Vec.zero)
      if (moveStart) {
         moveEnd = mouse
         // Compute how each point should move in response to the drag.

         // First pass: find the directions to snap in.
         let moveSnapDirs: Set<Vec> = new Set()
         let visited: Set<Point> = new Set()
         for (let point of pointsGrabbed) {
            visited.add(point)
            searchForDirections(point)
         }
         function searchForDirections(point: Point) {
            for (let p of circuitUndir.get(point)) {
               if (!visited.has(p)) {
                  moveSnapDirs.add(p.displacementFrom(point).direction())
                  visited.add(p)
                  searchForDirections(p)
               }
            }
         }
         // Now, snap to a direction if possible.
         moveEnd = trySnappingToDirections(moveEnd, moveStart, moveSnapDirs, 0)
         // Second pass: compute movement given the snapping.
         let moveVector = moveEnd.displacementFrom(moveStart)
         for (let point of pointsGrabbed) {
            moves.set(point, moveVector)
            propagateMovement(point)
         }
         function propagateMovement(point: Point) {
            for (let p of circuitUndir.get(point)) {
               let segment = p.displacementFrom(point)
               let rejection = moveVector.sub(
                  moveVector.projectionOnto(segment)
               )
               // TODO: After implementing reference lines, turn this tolerance
               // down.
               const errorTolerance = 1
               if (rejection.sqLength() > errorTolerance && !moves.has(p)) {
                  moves.set(p, moveVector)
                  propagateMovement(p)
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
         // Update the directed circuit.
         // Don't add the segment "backwards" if it already appears forward.
         if (!circuitDir.get(drawEnd).has(drawStart)) {
            circuitDir.get(drawStart).add(drawEnd)
         }
         circuitDir = circuitDir
         // Update the undirected circuit.
         circuitUndir.get(drawStart).add(drawEnd)
         circuitUndir.get(drawEnd).add(drawStart)
         circuitUndir = circuitUndir
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
      {#if moveStart && moveEnd}
         {#each pointsGrabbed as p}
            <line
               class="move"
               x1={p.x}
               y1={p.y}
               x2={p.x + moves.get(p).x}
               y2={p.y + moves.get(p).y}
            />
         {/each}
      {/if}
   </g>

   {#each [...circuitDir] as [start, ends]}
      {#each [...ends] as end}
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
