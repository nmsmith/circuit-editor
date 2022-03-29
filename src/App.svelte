<script lang="ts">
   import { Vec, Line } from "./math"
   // Snapping
   const snapDistanceSq = 15 * 15
   const lengthSqAtWhichSnapsActivate = 2 * snapDistanceSq

   // Snap if applicable, and return the outcome.
   function trySnapToPoint(source: Vec, target: Vec): [boolean, Vec] {
      if (source.distanceSq(target) < snapDistanceSq) {
         return [true, target.clone()]
      } else {
         return [false, source]
      }
   }
   function trySnapToLine(source: Vec, target: Line): [boolean, Vec] {
      // Use coordinates relative to one endpoint of the line
      let s = source.sub(target.start)
      let t = target.end.sub(target.start)
      let lenSq = t.lengthSq()
      let dot = s.dot(t)
      // The source is "next to" the line iff the dot product is in [0, lenSq]
      if (dot >= 0 && dot <= lenSq) {
         let projection = t.scale(dot / lenSq)
         let rejection = s.sub(projection)
         if (rejection.lengthSq() < snapDistanceSq) {
            return [true, target.start.add(projection)]
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
   let mouse: Vec = new Vec(0, 0)
   let lines: Line[] = []
   // The line that defines the current metric used for drawing
   let referenceLine: { line: Line; length: number } | null = null
   // Drawing state
   let lineStart: Vec | null = null
   let lineEnd: Vec | null

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
         const dv = lineEnd.sub(lineStart)
         let snapped = false
         if (!snappedToPoint && dv.lengthSq() >= lengthSqAtWhichSnapsActivate) {
            for (let dir of snapVectors) {
               // Projection onto unit vector
               const p = dir.scale(dv.dot(dir))
               ;[snapped] = trySnapToPoint(dv, p)
               if (snapped) {
                  lineEnd = lineStart.add(p)
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
      mouse = new Vec(event.clientX, event.clientY)
   }}
   on:pointerdown={(event) => {
      let click = new Vec(event.clientX, event.clientY)
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
