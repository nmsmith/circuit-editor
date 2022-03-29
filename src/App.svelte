<script lang="ts">
   import { Vec, Point, Line } from "./math"
   // Snapping
   const sqSnapDistance = 15 * 15
   const sqLengthAtWhichSnapsActivate = 2 * sqSnapDistance

   // Snap if applicable, and return the outcome.
   function trySnapToPoint(source: Point, target: Point): [boolean, Point] {
      if (source.sqDistanceFrom(target) < sqSnapDistance) {
         return [true, target.clone()]
      } else {
         return [false, source]
      }
   }
   // If close to the target line, snap by "growing"
   function trySnapToLine(source: Point, target: Line): [boolean, Point] {
      // Use coordinates relative to one endpoint of the line
      let s = source.displacementFrom(target.start)
      let t = target.end.displacementFrom(target.start)
      let lenSq = t.sqLength()
      let dot = s.dot(t)
      // The source is "next to" the line iff the dot product is in [0, lenSq]
      if (dot >= 0 && dot <= lenSq) {
         let projection = t.scaleBy(dot / lenSq)
         let rejection = s.sub(projection)
         if (rejection.sqLength() < sqSnapDistance) {
            return [true, target.start.displaceBy(projection)]
         } else {
            return [false, source]
         }
      } else {
         return [false, source]
      }
   }

   // Angle constants
   const tau = 2 * Math.PI

   const snapAngles = [
      // Ordered by priority
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
   // --------------- State ---------------
   let mouse: Point = new Point(0, 0)
   let lines: Line[] = []
   // The line that defines the current metric used for drawing
   let referenceLine: { line: Line; length: number } | null = null
   // Drawing state
   let lineStart: Point | null = null
   let lineEnd: Point | null

   $: {
      if (lineStart) {
         // By default, the line endpoint should be at the mouse position.
         lineEnd = mouse.clone()
         // But we're going to try and snap it to a bunch of things.
         let snappedToPoint = false
         // Priority #1: Try snapping to line endpoints.
         for (let line of lines) {
            ;[snappedToPoint, lineEnd] = trySnapToPoint(lineEnd, line.start)
            if (snappedToPoint) break
            ;[snappedToPoint, lineEnd] = trySnapToPoint(lineEnd, line.end)
            if (snappedToPoint) break
         }
         // Priority #2: Try snapping to angles.
         const dirLine = lineEnd.displacementFrom(lineStart)
         let snapped = false
         if (
            !snappedToPoint &&
            dirLine.sqLength() >= sqLengthAtWhichSnapsActivate
         ) {
            for (let dirSnap of snapVectors) {
               const dirProjected = dirLine.projectionOnto(dirSnap)
               const rejection = dirLine.sub(dirProjected)
               if (rejection.sqLength() < sqSnapDistance) {
                  snapped = true
                  lineEnd = lineStart.displaceBy(dirProjected)
                  break
               }
            }
         }
         // Priority #3: Try snapping to lines.
         if (!snappedToPoint) {
            for (let line of lines) {
               ;[snapped, lineEnd] = trySnapToLine(lineEnd, line)
               if (snapped) break
            }
         }
      } else {
         lineEnd = null
      }
   }
</script>

<svg
   on:pointermove={(event) => {
      mouse = new Point(event.clientX, event.clientY)
   }}
   on:pointerdown={(event) => {
      let click = new Point(event.clientX, event.clientY)
      // If we clicked near the endpoint of a line, snap to it.
      let snapped = false
      for (let line of lines) {
         ;[snapped, lineStart] = trySnapToPoint(click, line.start)
         if (snapped) break
         ;[snapped, lineStart] = trySnapToPoint(click, line.end)
         if (snapped) break
         trySnapToLine(click, line)
      }
      if (!snapped) {
         lineStart = click
      }
   }}
   on:pointerup={() => {
      if (lineStart && lineEnd) {
         lines = [...lines, new Line(lineStart, lineEnd)]
         lineStart = null
      }
   }}
>
   {#each lines as l}
      <line x1={l.start.x} y1={l.start.y} x2={l.end.x} y2={l.end.y} />
      {#each [...l.points(3)] as p}
         <circle cx={p.x} cy={p.y} r={4} />
      {/each}
   {/each}
   {#if lineStart && lineEnd}
      <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y} />
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
