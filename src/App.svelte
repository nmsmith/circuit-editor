<script lang="ts">
   // Math
   type Vec = { x: number; y: number }
   type Line = { start: Vec; end: Vec }
   function length(v: Vec): number {
      return Math.sqrt(v.x * v.x + v.y * v.y)
   }
   function lengthSq(v: Vec): number {
      return v.x * v.x + v.y * v.y
   }
   function distance(u: Vec, v: Vec): number {
      return length(sub(u, v))
   }
   function distanceSq(u: Vec, v: Vec): number {
      return lengthSq(sub(u, v))
   }
   function scale(v: Vec, s: number): Vec {
      return { x: s * v.x, y: s * v.y }
   }
   function add(u: Vec, v: Vec): Vec {
      return { x: u.x + v.x, y: u.y + v.y }
   }
   function sub(u: Vec, v: Vec): Vec {
      return { x: u.x - v.x, y: u.y - v.y }
   }
   function dot(u: Vec, v: Vec): number {
      return u.x * v.x + u.y * v.y
   }
   function clone(v: Vec): Vec {
      return { x: v.x, y: v.y }
   }
   // Angle constants
   const tau = 2 * Math.PI
   const snapDistanceSq = 15 * 15
   const lengthSqAtWhichSnapsActivate = 2 * snapDistanceSq
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
      return { x: Math.cos(a), y: Math.sin(a) }
   })
   // State
   let mouse: Vec = { x: 0, y: 0 }
   let lines: Line[] = []
   let lineStart: Vec | null = null
   let lineEnd: Vec | null

   $: {
      if (lineStart) {
         let snapped = false
         // If the line is close to the endpoint of another line, then snap it.
         for (let line of lines) {
            if (distanceSq(mouse, line.start) < snapDistanceSq) {
               lineEnd = clone(line.start)
               snapped = true
               break
            }
            if (distanceSq(mouse, line.end) < snapDistanceSq) {
               lineEnd = clone(line.end)
               snapped = true
               break
            }
         }
         // If the line is close to a snap angle, then snap it.
         const dv = sub(mouse, lineStart)
         if (!snapped && lengthSq(dv) >= lengthSqAtWhichSnapsActivate) {
            for (let dir of snapVectors) {
               // Projection onto unit vector
               const p = scale(dir, dot(dv, dir))
               // Rejection from unit vector
               const d = sub(dv, p)
               if (lengthSq(d) < snapDistanceSq) {
                  lineEnd = add(lineStart, p)
                  snapped = true
                  break
               }
            }
         }
         if (!snapped) {
            lineEnd = clone(mouse)
         }
      } else {
         lineEnd = null
      }
   }
</script>

<svg
   on:pointermove={(event) => {
      mouse = { x: event.clientX, y: event.clientY }
   }}
   on:pointerdown={(event) => {
      if (lineStart && lineEnd) {
         lines = [...lines, { start: lineStart, end: lineEnd }]
         lineStart = null
      } else {
         let click = { x: event.clientX, y: event.clientY }
         // If we clicked near the endpoint of a line, snap to it.
         // TODO: This code is a duplicate of the lineEnd code. Refactor it.
         let snapped = false
         for (let line of lines) {
            if (distanceSq(click, line.start) < snapDistanceSq) {
               lineStart = clone(line.start)
               snapped = true
               break
            }
            if (distanceSq(click, line.end) < snapDistanceSq) {
               lineStart = clone(line.end)
               snapped = true
               break
            }
         }
         if (!snapped) {
            lineStart = click
         }
      }
   }}
>
   {#each lines as l}
      <line x1={l.start.x} y1={l.start.y} x2={l.end.x} y2={l.end.y} />
   {/each}
   {#if lineStart && lineEnd}
      <text x="16px" y="40px">
         The end position is {lineEnd.x} x {lineEnd.y}
      </text>
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
   .axisLine {
      /* Don't apply antialiasing to horizontal and vertical lines. */
      shape-rendering: crispEdges;
   }
</style>
