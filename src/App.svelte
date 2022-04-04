<script lang="ts">
   import { Vec, Point, Ray, Segment } from "./math"
   // Angle constants
   const tau = 2 * Math.PI
   // Snapping
   const sqSnapDistance = 15 * 15
   const sqLengthAtWhichSnapsActivate = 2 * sqSnapDistance
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
   const snapVectors = snapAngles.map((a) => {
      return new Vec(Math.cos(a), Math.sin(a))
   })

   // Snap the point to a significant point in the scene, if possible.
   // Otherwise, return the same point.
   function trySnappingToPoint(point: Point): Point {
      // Try snapping to segment endpoints.
      for (let p of circuitUndir.keys()) {
         if (p.sqDistanceFrom(point) < sqSnapDistance) return p
      }
      // Try snapping to points along the reference segment.
      if (reference) {
         for (let p of reference.segment.points(reference.length - 1)) {
            if (p.sqDistanceFrom(point) < sqSnapDistance) return p
         }
      }
      return point
   }
   // Snap the point to a nearby line segment, if possible.
   // Otherwise, return the same point.
   function trySnappingToSegment(
      point: Point,
      snapDirection?: Vec // If empty, we will just project onto the segment.
   ): Point {
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
            if (rejection.sqLength() < sqSnapDistance) {
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
                     let target = new Segment(start, end)
                     let intersection =
                        forward.intersection(target) ||
                        backward.intersection(target)
                     if (intersection) {
                        return intersection
                     }
                  }
               } else {
                  // Otherwise, snap in the direction of the projection.
                  return start.displaceBy(projection)
               }
            }
         }
      }
      return point
   }

   // --------------- State ---------------
   // The circuit is stored as an adjacency list to enable efficient graph
   // traversals. We store the circuit twice. The first encoding is directed,
   // so every edge is only stored once. This is necessary for some operations.
   // The second encoding is undirected, so every edge is stored twice. This
   // is necessary for graph traversal operations.
   let circuitDir: Map<Point, Set<Point>> = new Map()
   let circuitUndir: Map<Point, Set<Point>> = new Map()
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
   let drawEnd: Point | null
   let dragStart: Point | null = null
   let dragEnd: Point | null

   $: {
      drawEnd = null
      if (drawStart) {
         // Try snapping to a point of significance.
         drawEnd = trySnappingToPoint(mouse)
         if (drawEnd === mouse) {
            // If no snapping occurred, try snapping to an angle and/or a
            // line segment instead.
            const dir = mouse.displacementFrom(drawStart)
            if (dir.sqLength() >= sqLengthAtWhichSnapsActivate) {
               for (let dirSnap of snapVectors) {
                  const dirProjected = dir.projectionOnto(dirSnap)
                  const rejection = dir.sub(dirProjected)
                  if (rejection.sqLength() < sqSnapDistance) {
                     drawEnd = drawStart.displaceBy(dirProjected)
                     break
                  }
               }
            }
            let snapDirection = drawEnd.displacementFrom(drawStart)
            drawEnd = trySnappingToSegment(drawEnd, snapDirection)
         }
      }
   }
</script>

<svg
   on:pointermove={(event) => {
      mouse = new Point(event.clientX, event.clientY)
   }}
   on:pointerdown={(event) => {
      let clickPosition = new Point(event.clientX, event.clientY)
      // Try snapping to a point of significance.
      drawStart = trySnappingToPoint(clickPosition)
      if (drawStart === clickPosition) {
         // If no snapping occurred, try snapping to a segment instead.
         drawStart = trySnappingToSegment(drawStart)
      }
   }}
   on:pointerup={() => {
      // Note: if drawStart or drawEnd have been chosen as the result of
      // snapping, then they will refer to existing Point objects. This is
      // crucial to ensuring that the circuit Maps and Sets accurately reflect
      // the circuit topology.
      if (drawStart && drawEnd) {
         // Update the directed circuit.
         // Don't add the segment "backwards" if it already appears forward.
         if (!circuitDir.get(drawEnd)?.has(drawStart)) {
            let segments = circuitDir.get(drawStart)
            if (segments) {
               segments.add(drawEnd)
            } else {
               circuitDir.set(drawStart, new Set([drawEnd]))
            }
         }
         circuitDir = circuitDir
         // Update the undirected circuit.
         let segmentsAtStart = circuitUndir.get(drawStart)
         if (segmentsAtStart) {
            segmentsAtStart.add(drawEnd)
         } else {
            circuitUndir.set(drawStart, new Set([drawEnd]))
         }
         let segmentsAtEnd = circuitUndir.get(drawEnd)
         if (segmentsAtEnd) {
            segmentsAtEnd.add(drawStart)
         } else {
            circuitUndir.set(drawEnd, new Set([drawStart]))
         }
         circuitUndir = circuitUndir
         // Reset the dragging start point
         drawStart = null
      }
   }}
>
   <!-- {#if drawStart && drawEnd}
      {#each segments as seg}
         <circle
            r={7}
            cx={new Segment(drawStart, drawEnd).intersection(seg)?.x}
            cy={new Segment(drawStart, drawEnd).intersection(seg)?.y}
         />
      {/each}
   {/if} -->
   {#each [...circuitDir] as [start, ends]}
      {#each [...ends] as end}
         <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
         {#each [...new Segment(start, end).points(0)] as p}
            <circle cx={p.x} cy={p.y} r={4} />
         {/each}
      {/each}
   {/each}
   {#if drawStart && drawEnd}
      <line x1={drawStart.x} y1={drawStart.y} x2={drawEnd.x} y2={drawEnd.y} />
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
   line {
      stroke: rgb(106, 2, 167);
      stroke-width: 2px;
   }
   circle {
      fill: black;
   }
</style>
