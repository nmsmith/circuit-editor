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

   function pointsCanSnap(p: Point, q: Point): boolean {
      return p.sqDistanceFrom(q) < sqSnapDistance
   }
   function trySnapToSegment(
      point: Point,
      target: Segment,
      snapDirection?: Vec // If empty, we will just project onto the segment.
   ): Point | null {
      // Use coordinates relative to one endpoint of the segment.
      let p = point.displacementFrom(target.start)
      let t = target.end.displacementFrom(target.start)
      let sqLength = t.sqLength()
      let dot = p.dot(t)
      // Only attempt to snap the point if its projection lies on the segment.
      // This occurs iff the dot product is in [0, lenSq].
      if (dot >= 0 && dot <= sqLength) {
         // Only snap if the point is sufficiently close to the segment.
         let projection = t.scaleBy(dot / sqLength)
         let rejection = p.sub(projection)
         if (rejection.sqLength() < sqSnapDistance) {
            // If we have been given a snap direction, and the angle between
            // the segment and the snap direction is not too narrow, attempt
            // to snap to that direction.
            if (snapDirection) {
               let cosAngle =
                  t.dot(snapDirection) / (t.length() * snapDirection.length())
               if (Math.abs(cosAngle) <= cosMinimumSnapAngle) {
                  let forward = new Ray(point, snapDirection)
                  let backward = new Ray(point, snapDirection.scaleBy(-1))
                  return (
                     forward.intersection(target) ||
                     backward.intersection(target)
                  )
               } else return null
            } else {
               // Otherwise, snap in the direction of the projection.
               return target.start.displaceBy(projection)
            }
         } else return null
      } else return null
   }

   // --------------- State ---------------
   let mouse: Point = new Point(0, 0)
   let segments: Segment[] = []
   function* endpoints() {
      for (let seg of segments) {
         yield seg.start
         yield seg.end
      }
   }
   let segmentUnderMouse: Segment | null
   // The segment that defines the current metric used for drawing
   let reference: { segment: Segment; length: number } | null = null
   // Drawing state
   let segStart: Point | null = null
   let segEnd: Point | null

   $: {
      if (segStart) {
         // By default, the segment endpoint should be at the mouse position.
         segEnd = mouse
         let snappedToPoint
         // Priority #1: Try snapping to points along the reference segment.
         if (reference) {
            for (let p of reference.segment.points(reference.length - 1)) {
               if (pointsCanSnap(segEnd, p)) {
                  segEnd = snappedToPoint = p
                  break
               }
            }
         }
         // Priority #2: Try snapping to segment endpoints.
         if (!snappedToPoint) {
            for (let p of endpoints()) {
               if (pointsCanSnap(segEnd, p)) {
                  segEnd = snappedToPoint = p
                  break
               }
            }
         }
         // Priority #3: Try snapping to angles.
         const dir = segEnd.displacementFrom(segStart)
         if (
            !snappedToPoint &&
            dir.sqLength() >= sqLengthAtWhichSnapsActivate
         ) {
            for (let dirSnap of snapVectors) {
               const dirProjected = dir.projectionOnto(dirSnap)
               const rejection = dir.sub(dirProjected)
               if (rejection.sqLength() < sqSnapDistance) {
                  segEnd = segStart.displaceBy(dirProjected)
                  break
               }
            }
         }
         // Priority #4: Try snapping to segments.
         if (!snappedToPoint) {
            let snapDirection = segEnd.displacementFrom(segStart)
            for (let seg of segments) {
               snappedToPoint = trySnapToSegment(segEnd, seg, snapDirection)
               if (snappedToPoint) {
                  segEnd = snappedToPoint
                  break
               }
            }
         }
      } else {
         segEnd = null
      }
   }
</script>

<svg
   on:pointermove={(event) => {
      mouse = new Point(event.clientX, event.clientY)
   }}
   on:pointerdown={(event) => {
      segStart = new Point(event.clientX, event.clientY)
      let snappedToPoint
      // Priority #1: Try snapping to points along the reference segment.
      if (reference) {
         for (let p of reference.segment.points(reference.length - 1)) {
            if (pointsCanSnap(segStart, p)) {
               segEnd = snappedToPoint = p
               break
            }
         }
      }
      // Priority #2: Try snapping to segment endpoints.
      if (!snappedToPoint) {
         for (let p of endpoints()) {
            if (pointsCanSnap(segStart, p)) {
               segStart = snappedToPoint = p
               break
            }
         }
      }
      // Priority #3: Try snapping to segments.
      if (!snappedToPoint) {
         for (let seg of segments) {
            snappedToPoint = trySnapToSegment(segStart, seg)
            if (snappedToPoint) {
               segStart = snappedToPoint
               break
            }
         }
      }
   }}
   on:pointerup={() => {
      if (segStart && segEnd) {
         segments = [...segments, new Segment(segStart, segEnd)]
         segStart = null
      }
   }}
>
   <!-- {#if segStart && segEnd}
      {#each segments as seg}
         <circle
            r={7}
            cx={new Segment(segStart, segEnd).intersection(seg)?.x}
            cy={new Segment(segStart, segEnd).intersection(seg)?.y}
         />
      {/each}
   {/if} -->
   {#each segments as seg}
      <line x1={seg.start.x} y1={seg.start.y} x2={seg.end.x} y2={seg.end.y} />
      {#each [...seg.points(0)] as p}
         <circle cx={p.x} cy={p.y} r={4} />
      {/each}
   {/each}
   {#if segStart && segEnd}
      <line x1={segStart.x} y1={segStart.y} x2={segEnd.x} y2={segEnd.y} />
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
