<script lang="ts">
   import { Vec, Line } from "./math"
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
      return new Vec(Math.cos(a), Math.sin(a))
   })
   // State
   let mouse: Vec = new Vec(0, 0)
   let lines: Line[] = []
   let lineStart: Vec | null = null
   let lineEnd: Vec | null

   $: {
      if (lineStart) {
         let snapped = false
         // If the line is close to the endpoint of another line, then snap it.
         for (let line of lines) {
            if (mouse.distanceSq(line.start) < snapDistanceSq) {
               lineEnd = line.start.clone()
               snapped = true
               break
            }
            if (mouse.distanceSq(line.end) < snapDistanceSq) {
               lineEnd = line.end.clone()
               snapped = true
               break
            }
         }
         // If the line is close to a snap angle, then snap it.
         // TODO: If we are extending an existing line, we should also snap to
         // that line's angle, and to orthogonal angles.
         const dv = mouse.sub(lineStart)
         if (!snapped && dv.lengthSq() >= lengthSqAtWhichSnapsActivate) {
            for (let dir of snapVectors) {
               // Projection onto unit vector
               const p = dir.scale(dv.dot(dir))
               // Rejection from unit vector
               const d = dv.sub(p)
               if (d.lengthSq() < snapDistanceSq) {
                  lineEnd = lineStart.add(p)
                  snapped = true
                  break
               }
            }
         }
         if (!snapped) {
            lineEnd = mouse.clone()
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
      // TODO: This code is a duplicate of the lineEnd code. Refactor it.
      let snapped = false
      for (let line of lines) {
         if (click.distanceSq(line.start) < snapDistanceSq) {
            lineStart = line.start.clone()
            snapped = true
            break
         }
         if (click.distanceSq(line.end) < snapDistanceSq) {
            lineStart = line.end.clone()
            snapped = true
            break
         }
      }
      if (!snapped) {
         lineStart = click
      }
   }}
   on:pointerup={() => {
      if (lineStart && lineEnd) {
         lines = [...lines, { start: lineStart, end: lineEnd }]
         lineStart = null
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
</style>
