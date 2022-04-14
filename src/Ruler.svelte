<script lang="ts" context="module">
   import { Point, Line, Ray, Axis } from "./math"
   // Constants
   const rulerOpaqueDistance = 15 // Max distance at which opaque
   const rulerTransparentDistance = 60 // Min distance at which transparent
   const rulerTaperDistance = rulerTransparentDistance * Math.SQRT2
   // Model
   export class Ruler {
      readonly line: Line
      render: "line" | "ray" | "none"
      opacity: number
      rayDirection?: "forward" | "backward"
      constructor(origin: Point, axis: Axis, render: "line" | "ray" | "none") {
         this.line = new Line(origin, axis)
         this.render = render
         this.opacity = 1
      }
      setOpacity(refPoint: Point): void {
         let distance = this.line.distanceFrom(refPoint)
         if (this.render === "line") {
            const od = rulerOpaqueDistance
            const td = rulerTransparentDistance
            this.opacity = 1 - (distance - od) / (td - od)
         } else {
            // Figure out which way the ray should be pointing.
            let ray = new Ray(this.line.origin, this.line.axis)
            this.rayDirection = ray.shadowedBy(refPoint)
               ? "forward"
               : "backward"
            // Taper the opacity when the cursor is close to the origin.
            // This prevents too many rays from appearing.
            let originDistance = refPoint.distanceFrom(this.line.origin)
            if (originDistance === 0) {
               this.opacity = 0
            } else {
               let taper = Math.min(originDistance / rulerTaperDistance, 1)
               const od = taper * rulerOpaqueDistance
               const td = taper * rulerTransparentDistance
               this.opacity = taper * (1 - (distance - od) / (td - od))
            }
         }
      }
   }
</script>

<script lang="ts">
   export let ruler: Ruler
   $: origin = ruler.line.origin
   $: opacity = 0.16 * ruler.opacity
   $: pos = ruler.line.origin.displaceBy(ruler.line.axis.scaleBy(+9001))
   $: neg = ruler.line.origin.displaceBy(ruler.line.axis.scaleBy(-9001))
</script>

{#if ruler.render === "line"}
   <line x1={neg.x} y1={neg.y} x2={pos.x} y2={pos.y} {opacity} />
{:else if ruler.render === "ray"}
   {#if ruler.rayDirection === "forward"}
      <line x1={origin.x} y1={origin.y} x2={pos.x} y2={pos.y} {opacity} />
   {:else}
      <line x1={origin.x} y1={origin.y} x2={neg.x} y2={neg.y} {opacity} />
   {/if}
{/if}

<style>
   line {
      stroke: black;
      stroke-width: 7px;
   }
</style>
