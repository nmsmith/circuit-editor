<script lang="ts" context="module">
   // ------------------------- Exported definitions --------------------------
   export type Tool = "select & move" | "draw"
   export type LineType = "hydraulic" | "pilot" | "drain"
</script>

<script lang="ts">
   import { onMount } from "svelte"
   import {
      Vertex,
      isVertex,
      rememberAxis,
      findAxis,
      Junction,
      Port,
      Segment,
      CrossingType,
      Crossing,
      SymbolKind,
      SymbolInstance,
      convertToJunction,
      Edge,
   } from "~/shared/definitions"
   import {
      Object2D,
      Vector,
      Point,
      Rotation,
      Direction,
      Axis,
      Range2D,
      ClosenessResult,
      closestTo,
      closestSegmentTo,
   } from "~/shared/geometry"
   import * as Geometry from "~/shared/geometry"
   import {
      mouseInCoordinateSystemOf,
      DefaultMap,
      ToggleSet,
   } from "~/shared/utilities"
   import FluidLine from "~/components/lines/FluidLine.svelte"
   import Hopover from "~/components/lines/Hopover.svelte"
   import JunctionNode from "~/components/lines/JunctionNode.svelte"
   import PointMarker from "~/components/PointMarker.svelte"
   import RectSelectBox from "~/components/RectSelectBox.svelte"
   import Plug from "~/components/lines/Plug.svelte"

   // ---------------------- Props (for input & output) -----------------------
   // Props that must be bound by the parent component.
   export let shift: boolean
   export let alt: boolean
   export let cmd: boolean
   export let debug: boolean
   export let onSymbolLeave: (
      kind: SymbolKind,
      grabOffset: Vector,
      event: MouseEvent
   ) => void
   // Values shared with the parent component.
   export const onToolSelected = toolSelected
   export const onNextLineType = nextLineType
   export const onDelete = deleteSelected
   export const onSymbolEnter = spawnSymbol
   // Events triggered by updates to props.
   $: shift ? shiftDown() : shiftUp()
   $: alt ? altDown() : altUp()
   $: cmd ? cmdDown() : cmdUp()

   // ------------------------------ Constants --------------------------------
   let canvas: SVGElement // the root element of this component
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   // Configurable constants
   const sqMinSegmentLength = 15 * 15
   // Circuit-sizing constants
   const standardGap = 30 // standard spacing between scene elements
   const halfGap = standardGap / 2
   const hopoverRadius = halfGap / 2
   const gapSelectError = 1 // diff from standardGap acceptable to gap select
   // Snapping constants
   const easeRadius = 30 // dist btw mouse & snap point at which easing begins
   const snapRadius = 12 // dist btw mouse & snap point at which snapping occurs
   const snapJump = 5 // the distance things move at the moment they snap
   const sqEaseRadius = easeRadius * easeRadius
   const sqSnapRadius = snapRadius * snapRadius
   const sqInteractRadius = sqSnapRadius
   // The major axes that drawing occurs along.
   const primaryAxes = [Axis.horizontal, Axis.vertical]
   const snapAxes = [
      Axis.horizontal,
      Axis.vertical,
      findAxis(Axis.fromAngle(0.125 * tau)), // 45 degrees
      findAxis(Axis.fromAngle(0.375 * tau)), // 135 degrees
   ]
   snapAxes.forEach(rememberAxis)
   // The toggle order of the glyphs that appear at crossings.
   const crossingToggleSeq: CrossingType[] = [
      "no hop",
      "V right",
      "H down",
      "V left",
      "H up",
   ]

   // ---------------------- Supplementary definitions ------------------------
   type Highlightable = Point | Segment | SymbolInstance
   type Attachable = Vertex | Segment // Something a segment can be attached to.
   type Toggleable = Vertex | Segment | Crossing
   type Grabbable = Junction | Segment | SymbolInstance
   type Selectable = Grabbable
   type Movable = Junction | SymbolInstance // Things that move when dragged.
   function isMovable(thing: any): thing is Movable {
      return thing instanceof Junction || thing instanceof SymbolInstance
   }
   function movableAt(vertex: Vertex): Movable {
      return vertex instanceof Junction ? vertex : vertex.symbol
   }
   function* vertices(): Generator<Vertex> {
      for (let v of Junction.s) yield v
      for (let v of Port.s) yield v
   }
   function* crossings(): Generator<Crossing> {
      for (let [seg1, map] of crossingMap) {
         for (let [seg2, point] of map) yield new Crossing(seg1, seg2, point)
      }
   }
   function* movables(): Generator<Movable> {
      for (let m of Junction.s) yield m
      for (let m of SymbolInstance.s) yield m
   }
   function closestNearTo<T extends Object2D>(
      point: Point,
      ...objectSets: Iterable<T>[]
   ): ClosenessResult<T> {
      let closest = closestTo(point, ...objectSets)
      if (
         closest &&
         closest.closestPart.sqDistanceFrom(point) < sqInteractRadius
      ) {
         return closest
      }
   }
   function closestSegmentNearTo(
      point: Point,
      alongAxis: Axis
   ): ClosenessResult<Segment> {
      let closest = closestSegmentTo(point, alongAxis, Segment.s)
      let sqBuffer = hopoverRadius * hopoverRadius
      if (
         closest &&
         closest.closestPart.sqDistanceFrom(point) < sqInteractRadius &&
         closest.closestPart.sqDistanceFrom(closest.object.start) >= sqBuffer &&
         closest.closestPart.sqDistanceFrom(closest.object.end) >= sqBuffer
      ) {
         return closest
      }
   }
   function closestAttachable(point: Point): ClosenessResult<Attachable> {
      return closestNearTo(point, vertices()) || closestNearTo(point, Segment.s)
   }
   function closestToggleable(point: Point): ClosenessResult<Toggleable> {
      return (
         closestNearTo<Vertex | Crossing>(point, vertices(), crossings()) ||
         closestNearTo(point, Segment.s)
      )
   }
   function closestAttachableOrToggleable(
      point: Point
   ): ClosenessResult<Attachable | Toggleable> {
      // This additional function is necessary because the individual functions
      // don't compose.
      return (
         closestNearTo<Vertex | Crossing>(point, vertices(), crossings()) ||
         closestNearTo(point, Segment.s)
      )
   }
   function closestGrabbable(point: Point): ClosenessResult<Grabbable> {
      return (
         closestNearTo(point, Junction.s) ||
         closestNearTo(point, SymbolInstance.s) ||
         closestNearTo(point, Segment.s)
      )
   }
   // ✨ A magical easing function for aesthetically-pleasing snapping. The
   // source is displaced from its true position as it approaches the target.
   function easeFn(distance: number): number {
      const a =
         (snapRadius - snapJump) /
         (sqSnapRadius + sqEaseRadius - 2 * snapRadius * easeRadius)
      const b = -2 * a * easeRadius
      const c = -a * sqEaseRadius - b * easeRadius
      return a * distance * distance + b * distance + c
   }
   type HighlightStyle = "hover" | "select" | "debug" | undefined
   function styleOf(thing: Highlightable | Selectable): HighlightStyle {
      if (selected.has(thing as Selectable)) return "select"
      else if (highlighted.has(thing)) return "hover"
      else if (autoSelectedMovables.includes(thing as Movable)) return "debug"
   }
   function layerOf(point: Point): "lower" | "upper" {
      return point instanceof Port || point === move?.draw?.segment.end
         ? "upper"
         : "lower"
   }
   function shouldExtendTheSegmentAt(
      junction: Junction,
      drawAxis: Axis
   ): boolean {
      return (
         junction.edges().size === 1 && junction.axes()[0] === drawAxis && !alt
      )
   }
   function nearestAxis(to: Axis, ofAxes: Axis[]): Axis {
      let scores = ofAxes.map((axis) => Math.abs(to.dot(axis)))
      return ofAxes[scores.indexOf(Math.max(...scores))]
   }

   // ---------------------------- Primary state ------------------------------
   // Note: This is the state of the editor. The circuit is stored elsewhere.
   let mouse: { position: Point } & (
      | { state: "up" }
      // Pressing, but not yet moved enough to constitute a drag.
      | { state: "pressing"; downPosition: Point; downJunction?: Junction }
      | { state: "dragging"; downPosition: Point; downJunction?: Junction }
   ) = { position: Point.zero, state: "up" }
   let tool: Tool = "draw"
   let move: null | {
      axisGrabbed: Axis
      partGrabbed: Point
      distance: number
      originalPositions: DefaultMap<Movable | Vertex, Point>
      draw?: {
         segment: Segment
         segmentIsNew: boolean
         endObject?: Attachable
      }
   } = null
   let rectSelect: null | Set<Selectable> = null
   let selected: ToggleSet<Selectable> = new ToggleSet()

   // ---------------------------- Derived state ------------------------------
   let manuallySelectedMovables: Set<Movable>
   $: {
      manuallySelectedMovables = new Set()
      for (let g of selected) {
         if (isMovable(g)) {
            manuallySelectedMovables.add(g)
         } else {
            manuallySelectedMovables.add(
               isMovable(g.start) ? g.start : g.start.symbol
            )
            manuallySelectedMovables.add(
               isMovable(g.end) ? g.end : g.end.symbol
            )
         }
      }
   }
   type Pass = number
   type Forces = { push: Pass; strafeClock: Pass; strafeAnti: Pass }
   let forcesAtMovable: DefaultMap<Movable, DefaultMap<Segment, Forces>>
   let autoSelectedMovables: Movable[]
   let allSelectedMovables: Set<Movable>
   let basisAxes: DefaultMap<Movable, [Axis, Axis]>
   $: /* Determine the forces that each Movable may be subjected to. */ {
      forcesAtMovable = new DefaultMap(() => {
         return new DefaultMap(() => {
            return { push: 0, strafeClock: 0, strafeAnti: 0 }
         })
      })
      autoSelectedMovables = []
      allSelectedMovables = new Set(manuallySelectedMovables)
      // First pass: propagate the movement of the manually-selected movables.
      manuallySelectedMovables.forEach((m) => propagateFullForces(m, 1))
      // Second pass: propagate the movement of autoSelectedMovables,
      // and then ATTEMPT to find a suitable vector basis for every non-selected
      // Movable in the circuit. If we are unable to find a basis for a Movable,
      // we add it to autoSelectedMovables and do another iteration of the loop.
      let i = 0
      do {
         for (; i < autoSelectedMovables.length; ++i)
            propagateFullForces(autoSelectedMovables[i], 2)
         // Attempt to find a pair of basis axes for every non-selected Movable.
         basisAxes = new DefaultMap(() => [Axis.horizontal, Axis.vertical])
         for (let movable of movables()) {
            if (allSelectedMovables.has(movable)) continue
            let axes = new Set<Axis>() // axes of the incoming forces
            for (let s of forcesAtMovable.read(movable).keys()) axes.add(s.axis)
            if (axes.size > 2) {
               console.error("Impossible: 3 axes of force.")
               continue
            } else if (axes.size === 2) {
               let basis = [...axes] as [Axis, Axis]
               if (basisIsValid(movable, basis)) {
                  basisAxes.set(movable, basis)
               } else {
                  autoSelectedMovables.push(movable)
                  allSelectedMovables.add(movable)
               }
            } else if (axes.size === 1) {
               let firstAxis = [...axes][0]
               // Explore using each other axis for a possible basis.
               let orthogonalAxis = findAxis(firstAxis.orthogonal())
               let otherAxes = movable
                  .axes()
                  .filter((axis) => axis !== firstAxis)
               if (otherAxes.length === 0) {
                  // The Movable has one axis total.
                  basisAxes.set(movable, [firstAxis, orthogonalAxis])
               } else {
                  if (otherAxes.includes(orthogonalAxis)) {
                     // Prdioritize the orthogonal axis.
                     otherAxes[otherAxes.indexOf(orthogonalAxis)] = otherAxes[0]
                     otherAxes[0] = orthogonalAxis
                  }
                  let basisFound = false
                  for (let secondAxis of otherAxes) {
                     let basis = [firstAxis, secondAxis] as [Axis, Axis]
                     if (basisIsValid(movable, basis)) {
                        basisAxes.set(movable, basis)
                        basisFound = true
                        break
                     }
                  }
                  if (!basisFound) {
                     autoSelectedMovables.push(movable)
                     allSelectedMovables.add(movable)
                  }
               }
            } else if (axes.size === 0) {
               // This Movable isn't moved by a standard (basis) movement, but
               // if it has ≤ 2 axes, it will be moved by a secondary movement.
               let allAxes = movable.axes()
               if (allAxes.length === 2) {
                  basisAxes.set(movable, allAxes as [Axis, Axis])
               } else if (allAxes.length === 1) {
                  let orthogonal = findAxis(allAxes[0].orthogonal())
                  basisAxes.set(movable, [allAxes[0], orthogonal])
               } else continue
            }
         }
         // If elements were added to autoSelectedMovables, keep looping.
      } while (i < autoSelectedMovables.length)

      // Finally, disable pushing between pairs of Movables whose common edge
      // is strafable in such a way that it becomes longer. (Lengthening edges
      // interfere with the pushing calculations, because after lengthening,
      // an edge may need to transmit _less_ of a push.)
      for (let movableA of movables()) {
         if (allSelectedMovables.has(movableA)) continue
         for (let [segment, b] of movableA.edges()) {
            let movableB = movableAt(b)
            if (allSelectedMovables.has(movableB)) continue
            let forcesA = forcesAtMovable.read(movableA).getOrCreate(segment)
            let forcesB = forcesAtMovable.read(movableB).getOrCreate(segment)
            if (!forcesA.push && !forcesB.push) continue
            // Currently I'm disabling pushing if the edge can strafe in _any_
            // direction. But technically, I only need to consider strafing
            // that makes the edge longer.
            if (
               forcesA.strafeClock ||
               forcesA.strafeAnti ||
               forcesB.strafeClock ||
               forcesB.strafeAnti ||
               (forcesA.push && forcesB.push) // this case causes trouble too
            ) {
               let basisA = basisAxes.read(movableA)
               let basisB = basisAxes.read(movableB)
               // If the bases differ, the edge changes length when strafing.
               if (!basisA.every((axis) => basisB.includes(axis))) {
                  forcesA.push = 0
                  forcesB.push = 0
               }
            }
         }
      }

      function basisIsValid(movable: Movable, basis: [Axis, Axis]): boolean {
         // Check if all of the segments _outside_ the proposed basis are
         // able to be strafed to stay in sync with the basis movements.
         for (let [firstSegment, first] of movable.edges()) {
            if (basis.includes(firstSegment.axis)) continue
            // Traverse all segments sharing the firstSegment's axis.
            // Because firstSegment is not under the influence of a strafing
            // force, the other segments cannot be either. Thus, we can strafe
            // all the segments freely IFF their endpoints all have ≤ 2 axes,
            // and we don't propagate the strafes to the other axes (as pushes).
            // In the presence of Symbols, the segments sharing firstSegment's
            // axis could form a cyclic subgraph. Therefore, we do a depth-first
            // search, carefully ensuring we never visit the same Movable twice.
            let toVisit = [movableAt(first)]
            let found = new Set([movable, movableAt(first)])
            while (toVisit.length > 0) {
               let m = toVisit.pop() as Movable
               // If the Movable has more than 2 axes, the basis is invalid.
               if (m.axes().length > 2) return false
               // Keep traversing parallel segments.
               for (let [seg, next] of m.edges()) {
                  let nextM = movableAt(next)
                  if (seg.axis === firstSegment.axis && !found.has(nextM)) {
                     toVisit.push(nextM)
                     found.add(nextM)
                  }
               }
            }
         }
         return true
      }
      function propagateFullForces(movable: Movable, pass: Pass) {
         for (let [segment, next] of movable.edges()) {
            let nextMovable = movableAt(next)
            if (allSelectedMovables.has(nextMovable)) continue
            let push = shouldPush(movable, segment, nextMovable) ? pass : 0
            propagateForces(
               nextMovable,
               segment,
               { push, strafeClock: pass, strafeAnti: pass },
               pass
            )
         }
      }
      function shouldPush(
         movable: Movable,
         segment: Segment,
         nextMovable: Movable
      ) {
         // Don't transmit a push force if the segment can be inverted
         // without overlapping other circuit geometry.
         if (movable instanceof Junction && nextMovable instanceof Junction) {
            for (let [s] of [...movable.edges(), ...nextMovable.edges()]) {
               if (s !== segment && s.axis === segment.axis) return true
            }
            return false
         } else return true
      }
      function propagateForces(
         movable: Movable,
         source: Segment,
         forces: Forces,
         pass: Pass
      ) {
         // Register the forces that the Segment applies to the Movable.
         let existing = forcesAtMovable.read(movable).read(source)
         let somethingNew =
            (forces.push && !existing.push) ||
            (forces.strafeClock && !existing.strafeClock) ||
            (forces.strafeAnti && !existing.strafeAnti)
         if (!somethingNew) return // check for progress (ensuring termination)
         forcesAtMovable.getOrCreate(movable).set(source, {
            push: existing.push || forces.push,
            strafeClock: existing.strafeClock || forces.strafeClock,
            strafeAnti: existing.strafeAnti || forces.strafeAnti,
         })
         // If the movable now has forces applied to 3 of its axes, treat the
         // movable as if it were part of the original selection.
         let axes = new Set<Axis>()
         for (let s of forcesAtMovable.read(movable).keys()) axes.add(s.axis)
         if (axes.size >= 3) {
            //forcesAtMovable.delete(movable) // we don't need this info
            autoSelectedMovables.push(movable)
            allSelectedMovables.add(movable)
            return
         }
         function vectorOf(s: Segment): Vector {
            if (move) {
               // The direction that the segment is "emerging" from the Movable
               // must be determined by its pre-movement position, not its
               // dynamic position. Otherwise, if the segment happens to invert
               // during movement, the force computations will radically change.
               return movableAt(s.start) === movable
                  ? move.originalPositions
                       .read(s.end)
                       .displacementFrom(move.originalPositions.read(s.start))
                  : move.originalPositions
                       .read(s.start)
                       .displacementFrom(move.originalPositions.read(s.end))
            } else {
               return movableAt(s.start) === movable
                  ? s.end.displacementFrom(s.start)
                  : s.start.displacementFrom(s.end)
            }
         }
         let sourceVector = vectorOf(source)
         // Propagate the forces along each other edge of the Movable.
         for (let [segment, nextVertex] of movable.edges()) {
            let nextMovable = movableAt(nextVertex)
            if (segment === source || allSelectedMovables.has(nextMovable))
               continue
            let segmentVector = vectorOf(segment)
            let side: "same" | "opposite" | "clock" | "anti"
            if (segment.axis === source.axis) {
               if (movable instanceof Junction) {
                  side = "opposite"
               } else {
                  let s = segmentVector.direction()
                  let o = sourceVector.direction()
                  side = s?.approxEquals(o, 0.1) ? "same" : "opposite"
               }
            } else {
               side =
                  Math.sign(
                     segmentVector
                        .rejectionFrom(sourceVector)
                        .relativeTo(sourceVector).y
                  ) > 0
                     ? "clock"
                     : "anti"
            }
            let push =
               ((side === "opposite" && forces.push) ||
                  (side === "clock" && forces.strafeClock) ||
                  (side === "anti" && forces.strafeAnti)) &&
               shouldPush(movable, segment, nextMovable)
            let strafeClock =
               (side === "opposite" && forces.strafeClock) ||
               (side === "same" && forces.strafeAnti) ||
               (side === "anti" && forces.push)
            let strafeAnti =
               (side === "opposite" && forces.strafeAnti) ||
               (side === "same" && forces.strafeClock) ||
               (side === "clock" && forces.push)
            let next = {
               // Map Booleans to the pass number.
               push: push ? pass : 0,
               strafeClock: strafeClock ? pass : 0,
               strafeAnti: strafeAnti ? pass : 0,
            }
            if (next.push || next.strafeClock || next.strafeAnti)
               propagateForces(nextMovable, segment, next, pass)
         }
      }
   }
   let pushPaths: Set<[Pass, string]> // SVG paths showing pushing forces.
   let strafePaths: Set<[Pass, string]> // SVG paths showing strafing forces.
   let basisPaths: Set<string> // SVG paths showing basis axes.
   $: /* Compute SVG paths for the movement debug visualization. */ {
      pushPaths = new Set()
      strafePaths = new Set()
      basisPaths = new Set()
      if (debug) {
         // Compute SVG paths for pushing and strafing.
         for (let [movable, map] of forcesAtMovable) {
            for (let [segment, forces] of map) {
               let [near, far] =
                  movableAt(segment.start) === movable
                     ? [segment.start, segment.end]
                     : [segment.end, segment.start]
               let away = far.directionFrom(near)
               if (!away) continue
               let w1 = away
                  .rotatedBy(Rotation.fromAngle(0.25 * tau))
                  .scaledBy(7)
               let w2 = away
                  .rotatedBy(Rotation.fromAngle(0.75 * tau))
                  .scaledBy(7)
               let path = ""
               if (forces.push) {
                  let tri1 = near.displacedBy(away.scaledBy(4))
                  let tri2 = near.displacedBy(away.scaledBy(11)).displacedBy(w1)
                  let tri3 = near.displacedBy(away.scaledBy(11)).displacedBy(w2)
                  pushPaths.add([
                     forces.push,
                     `M${tri1.x},${tri1.y} L${tri2.x},${tri2.y} L${tri3.x},${tri3.y} Z`,
                  ])
               }
               if (forces.strafeClock) {
                  let line1 = near.displacedBy(away.scaledBy(15))
                  let line2 = line1.displacedBy(w1)
                  strafePaths.add([
                     forces.strafeClock,
                     `M${line1.x},${line1.y} L${line2.x},${line2.y}`,
                  ])
               }
               if (forces.strafeAnti) {
                  let line1 = near.displacedBy(away.scaledBy(15))
                  let line2 = line1.displacedBy(w2)
                  strafePaths.add([
                     forces.strafeAnti,
                     `M${line1.x},${line1.y} L${line2.x},${line2.y}`,
                  ])
               }
            }
         }
         // Compute SVG paths to show which axes were chosen as the basis axes.
         for (let movable of movables()) {
            let basis = basisAxes.get(movable)
            if (!basis) continue
            for (let [segment] of movable.edges()) {
               if (!basis.includes(segment.axis)) continue
               let [near, far] =
                  movableAt(segment.start) === movable
                     ? [segment.start, segment.end]
                     : [segment.end, segment.start]
               let dir = far.directionFrom(near)
               if (!dir) continue
               let end = near.displacedBy(dir.scaledBy(9))
               basisPaths.add(`M${near.x},${near.y} L${end.x},${end.y}`)
            }
         }
      }
   }
   let crossingMap: DefaultMap<Segment, Map<Segment, Point>>
   $: /* Determine which Segments are crossing, and where they cross. */ {
      crossingMap = new DefaultMap(() => new Map())
      for (let seg1 of Segment.s) {
         for (let seg2 of Segment.s) {
            if (seg1.connectsTo(seg2)) continue
            let crossPoint = seg1.intersection(seg2)
            if (crossPoint) {
               let ends = [seg1.start, seg1.end, seg2.start, seg2.end]
               let minDistance = Math.min(
                  ...ends.map((p) => p.distanceFrom(crossPoint as Point))
               )
               if (minDistance >= hopoverRadius + 4) {
                  crossingMap.getOrCreate(seg1).set(seg2, crossPoint)
                  crossingMap.getOrCreate(seg2).set(seg1, crossPoint)
               }
            }
         }
      }
   }
   let cursor: "default" | "cell" | "grab" | "grabbing"
   $: /* Where helpful, change the appearance of the mouse cursor. */ {
      if (tool === "draw") {
         cursor = "cell"
      } else if (move) {
         cursor = "grabbing"
      } else {
         cursor = "default"
         let grab = closestGrabbable(mouse.position)
         if (tool === "select & move" && grab && !shift && !alt && !cmd) {
            cursor = mouse.state === "pressing" ? "grabbing" : "grab"
         }
      }
   }
   let highlighted: Set<Highlightable>
   $: /* Highlight objects near the mouse cursor. */ {
      highlighted = new Set()
      if (move?.draw?.endObject instanceof Segment) {
         highlighted.add(move.draw.endObject)
      } else if (rectSelect) {
         highlighted = new Set(rectSelect)
      } else if (gapHighlighted.size > 0) {
         for (let s of gapHighlighted) highlighted.add(s)
      } else if (tool === "select & move" && !move) {
         let grab = closestGrabbable(mouse.position)
         if (grab) highlighted.add(grab.object)
      } else if (tool === "draw" && !move) {
         let thing = closestAttachableOrToggleable(mouse.position)
         if (thing) {
            if (thing.object instanceof Crossing) {
               highlighted.add(thing.closestPart)
            } else {
               highlighted.add(thing.object)
            }
         }
      }
   }
   let gapHighlighted: Set<Segment>
   $: /* When activated, highlight all objects which are standardGap apart.*/ {
      if (tool === "select & move" && !move && cmd) {
         gapHighlighted = new Set()
         let s = closestNearTo(mouse.position, Segment.s)
         if (s) {
            // Do gap highlighting (and later, selection) along the axis
            // orthogonal to the segment's axis. To achieve this, we
            // re-coordinatize every object that has the same orientation as
            // the segment as an AABB, and search along the resultant y-axis.
            let selectAxis = s.object.axis
            let orthAxis = findAxis(selectAxis.orthogonal())
            type SegmentInfo = {
               segment: Segment
               x: number[]
               y: number[]
               visited: boolean
            }
            let info = new Map<Segment, SegmentInfo>()
            for (let seg of Segment.s) {
               if (seg.axis !== selectAxis && seg.axis !== orthAxis) continue
               let start = seg.start.relativeTo(selectAxis)
               let end = seg.end.relativeTo(selectAxis)
               let x = start.x <= end.x ? [start.x, end.x] : [end.x, start.x]
               let y = start.y <= end.y ? [start.y, end.y] : [end.y, start.y]
               info.set(seg, { segment: seg, x, y, visited: false })
            }
            let [front, back] =
               s.closestPart
                  .displacementFrom(mouse.position)
                  .relativeTo(selectAxis).y > 0
                  ? [0, 1]
                  : [1, 0]
            gapHighlighted.add(s.object)
            let startInfo = info.get(s.object) as SegmentInfo
            startInfo.visited = true
            highlightFrom(startInfo)
            function highlightFrom(current: SegmentInfo) {
               for (let i of info.values()) {
                  if (i.visited) continue
                  let disp = (back - front) * (i.y[front] - current.y[back])
                  if (
                     // If the bounding boxes are touching...
                     Math.abs(disp - standardGap) < gapSelectError &&
                     i.x[0] <= current.x[1] + standardGap &&
                     i.x[1] >= current.x[0] - standardGap
                  ) {
                     gapHighlighted.add(i.segment)
                     i.visited = true
                     highlightFrom(i)
                  }
               }
            }
         }
      } else {
         gapHighlighted = new Set()
      }
   }
   type Section = Geometry.LineSegment<Point>
   type Glyph =
      | {
           type: "hopover"
           segment: Segment
           point: Point
           start: Point
           end: Point
           flip: boolean
           style: HighlightStyle
        }
      | { type: "junction node"; junction: Junction; style: HighlightStyle }
      | { type: "plug"; vertex: Vertex; style: HighlightStyle }
      | { type: "point marker"; point: Point; style: HighlightStyle }
   let segmentsToDraw: Map<Segment, Section[]>
   let glyphsToDraw: Set<Glyph>
   $: /* Determine which SVG elements (line segments and glyphs) to draw. */ {
      segmentsToDraw = new Map()
      glyphsToDraw = new Set()
      for (let segment of Segment.s) {
         // This array will collect the segment endpoints, and all of the
         // points at which the hopovers should be spliced into the segment.
         let points: Point[] = [segment.start, segment.end]
         for (let [other, crossPoint] of crossingMap.read(segment)) {
            // Determine which segment is the "horizontal" one.
            let segReject = segment.axis.scalarRejectionFrom(Axis.horizontal)
            let otherReject = other.axis.scalarRejectionFrom(Axis.horizontal)
            let hSegment: Segment
            if (Math.abs(segReject) < Math.abs(otherReject)) {
               hSegment = segment
            } else if (Math.abs(segReject) > Math.abs(otherReject)) {
               hSegment = other
            } else {
               hSegment = segReject < otherReject ? segment : other
            }
            // Determine which segment will hop over the other.
            let type = segment.crossingTypes.read(other)
            if (
               (hSegment === segment && (type == "H up" || type == "H down")) ||
               (hSegment === other && (type == "V left" || type == "V right"))
            ) {
               let [start, end] = [
                  crossPoint.displacedBy(segment.axis.scaledBy(hopoverRadius)),
                  crossPoint.displacedBy(segment.axis.scaledBy(-hopoverRadius)),
               ]
               points.push(start, end)
               let flip = type === "H down" || type === "V right"
               glyphsToDraw.add({
                  type: "hopover",
                  segment,
                  point: crossPoint,
                  start,
                  end,
                  flip,
                  style: styleOf(segment) || styleOf(crossPoint),
               })
            } else if (type === "no hop" && highlighted.has(crossPoint)) {
               glyphsToDraw.add({
                  type: "point marker",
                  point: crossPoint,
                  style: styleOf(crossPoint),
               })
            }
         }
         // Compute the sections that need to be drawn.
         let distanceOf = (p: Point) => p.sqDistanceFrom(segment.start)
         points.sort((a, b) => distanceOf(a) - distanceOf(b))
         let sections: Section[] = []
         for (let i = 0; i < points.length; i += 2) {
            sections.push(
               new Geometry.LineSegment(points[i], points[i + 1], segment.axis)
            )
         }
         segmentsToDraw.set(segment, sections)
      }
      // Determine the other glyphs that need to be drawn at vertices.
      for (let v of vertices()) {
         if (v.glyph === "plug") {
            glyphsToDraw.add({ type: "plug", vertex: v, style: styleOf(v) })
         } else if (v instanceof Junction) {
            if (v.edges().size > 2) {
               glyphsToDraw.add({
                  type: "junction node",
                  junction: v,
                  style: styleOf(v),
               })
            } else if (
               v.isStraightLine() ||
               highlighted.has(v) ||
               selected.has(v) ||
               autoSelectedMovables.includes(v)
            ) {
               glyphsToDraw.add({
                  type: "point marker",
                  point: v,
                  style: styleOf(v),
               })
            }
         } else if (v instanceof Port && highlighted.has(v)) {
            glyphsToDraw.add({
               type: "point marker",
               point: v,
               style: styleOf(v),
            })
         }
      }
   }
   let drawMode: "strafing" | "snapped rotation" | "free rotation"
   $: /* Determine the current draw mode. */ {
      drawMode = alt
         ? shift
            ? "free rotation"
            : "snapped rotation"
         : "strafing"
      if (move) updateMove() // Treat changes to drawMode as events.
   }

   // ---------------------------- Primary events -----------------------------
   function toolSelected(newTool: Tool) {
      if (tool === newTool && tool === "draw" && move?.draw) {
         // Start a new draw operation at the current draw endpoint.
         let endpoint = move.draw.segment.end as Junction
         move.draw.endObject = undefined // Don't connect to anything else.
         endMove(false)
         mouse = {
            state: "pressing",
            position: mouse.position,
            downPosition: mouse.position,
            downJunction: endpoint,
         }
      } else {
         tool = newTool
         if (tool === "draw" && !move) selected = new ToggleSet()
      }
   }
   function nextLineType() {
      // TODO — toggle through line types.
   }
   function deleteSelected() {
      let junctionsToConvert = new Set<Junction>()
      for (let thing of selected) {
         if (thing instanceof Port) continue // Ports are not deletable.
         thing.delete().forEach((neighbor) => junctionsToConvert.add(neighbor))
      }
      for (let junction of junctionsToConvert) {
         if (junction.edges().size === 2)
            junction.convertToCrossing(crossingMap)
      }
      selected = new ToggleSet()
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function spawnSymbol(kind: SymbolKind, grabOffset: Vector, e: MouseEvent) {
      // Update the mouse's state.
      let p = mouseInCoordinateSystemOf(canvas, e)
      mouse = { state: "dragging", downPosition: p, position: p }
      // Spawn a symbol on the canvas, and initiate a move action.
      let spawnPosition = mouse.position.displacedBy(grabOffset)
      let symbol = new SymbolInstance(kind, spawnPosition, Rotation.zero)
      selected = new ToggleSet([symbol])
      beginMove("move", { grabbed: symbol, atPart: mouse.position })
   }
   function shiftDown() {}
   function shiftUp() {}
   function altDown() {
      if (move?.draw) {
         // Reset the reference information for the movement.
         move.partGrabbed = move.draw.segment.end.clone()
         for (let thing of move.originalPositions.keys()) {
            if (thing instanceof Junction || thing instanceof Port) {
               move.originalPositions.set(thing, thing.clone())
            } else {
               move.originalPositions.set(thing, thing.position.clone())
            }
         }
      }
   }
   function altUp() {}
   function cmdDown() {}
   function cmdUp() {}
   let waitedOneFrame = false
   function leftMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b1) === 1
   }
   function leftMouseDown() {
      let grab = closestGrabbable(mouse.position)
      if (tool === "select & move" && grab && !shift && !alt) {
         // Immediately treat the operation as a drag.
         mouse = { ...mouse, state: "dragging", downPosition: mouse.position }
         if (cmd) {
            selected.clear()
            for (let s of gapHighlighted) selected.add(s)
         } else if (!selected.has(grab.object)) {
            selected = new ToggleSet([grab.object])
         }
         beginMove("move", {
            grabbed: grab.object,
            atPart: grab.closestPart,
         })
      } else {
         mouse = { ...mouse, state: "pressing", downPosition: mouse.position }
      }
   }
   function mouseMoved(previousMousePosition: Point) {
      if (move)
         move.distance += mouse.position.distanceFrom(previousMousePosition)
      // Update the actions that depend on mouse movement. (It's important that
      // these updates are invoked BEFORE any begin___() functions. The begin___
      // funcs may induce changes to derived data that the updates need to see.)
      if (move) updateMove()
      if (rectSelect) updateRectSelect()
      if (mouse.state === "pressing") {
         // Check if the mouse has moved enough to constitute a drag.
         let dragVector = mouse.position.displacementFrom(mouse.downPosition)
         let sqLengthRequiredForDragStart = {
            "select & move": 4 * 4,
            draw: sqSnapRadius, // a larger value helps us deduce draw direction
         }
         if (dragVector.sqLength() >= sqLengthRequiredForDragStart[tool]) {
            mouse = { ...mouse, state: "dragging" }
            beginDragAction(dragVector)
         }
      }
   }
   function leftMousePressEnded(unexpectedly: true) {
      mouse = { state: "up", position: mouse.position }
   }
   function leftMouseDragEnded(unexpectedly: boolean = false) {
      if (move) endMove()
      if (rectSelect) endRectSelect()
      mouse = { state: "up", position: mouse.position }
   }
   function leftMouseClicked() {
      switch (tool) {
         case "select & move": {
            let grab = closestGrabbable(mouse.position)
            if (!grab) selected.clear()
            else if (shift && cmd) for (let s of gapHighlighted) selected.add(s)
            else if (shift && !cmd) selected.toggle(grab.object)
            else if (alt && cmd)
               for (let s of gapHighlighted) selected.delete(s)
            else if (alt && !cmd) selected.delete(grab.object)
            else selected = new ToggleSet([grab.object])
            selected = selected
            break
         }
         case "draw": {
            let toggle = closestToggleable(mouse.position)
            if (!toggle) break
            if (isVertex(toggle.object)) {
               if (toggle.object.glyph === "default") {
                  toggle.object.glyph = "plug"
               } else {
                  toggle.object.glyph = "default"
                  if (toggle.object instanceof Junction)
                     toggle.object.convertToCrossing(
                        crossingMap,
                        crossingToggleSeq[0]
                     )
               }
            } else if (toggle.object instanceof Segment) {
               let cutPoint = new Junction(toggle.closestPart)
               toggle.object.splitAt(cutPoint)
               cutPoint.glyph = "plug"
            } else if (toggle.object instanceof Crossing) {
               // Change the crossing glyph.
               let { seg1, seg2 } = toggle.object
               let oldType = seg1.crossingTypes.read(seg2)
               let i = crossingToggleSeq.indexOf(oldType) + 1
               if (i < crossingToggleSeq.length) {
                  seg1.crossingTypes.set(seg2, crossingToggleSeq[i])
                  seg2.crossingTypes.set(seg1, crossingToggleSeq[i])
               } else {
                  convertToJunction(toggle.object)
               }
            }
            Junction.s = Junction.s
            Segment.s = Segment.s
            Port.s = Port.s
            break
         }
      }
   }

   // ---------------------------- Derived events -----------------------------
   function beginDragAction(dragVector: Vector) {
      if (mouse.state !== "dragging") return
      switch (tool) {
         case "select & move":
            beginRectSelect(mouse.downPosition)
            break
         case "draw": {
            if (mouse.downJunction) {
               // Start the draw operation at the endpoint of the previous
               // draw operation.
               let lastDrawAxis = mouse.downJunction.axes()[0]
               // Determine the axis the draw operation should begin along.
               let drawAxis = findAxis(Axis.fromVector(dragVector) as Axis)
               if (drawMode === "strafing") {
                  drawAxis = nearestAxis(
                     drawAxis,
                     primaryAxes.filter((axis) => axis !== lastDrawAxis)
                  )
               } else if (drawMode === "snapped rotation") {
                  drawAxis = nearestAxis(
                     drawAxis,
                     snapAxes.filter((axis) => axis !== lastDrawAxis)
                  )
               }
               beginMove("draw", { start: mouse.downJunction, axis: drawAxis })
               break // Exit the switch statement.
            } else if (
               closestAttachableOrToggleable(mouse.downPosition)
                  ?.object instanceof Crossing
            ) {
               break // Don't allow draw operations to start at crossings.
            }
            // Otherwise, start the draw operation at the closest attachable.
            let attach = closestAttachable(mouse.downPosition)
            // Determine the axis the draw operation should begin along.
            let drawAxis = findAxis(Axis.fromVector(dragVector) as Axis)
            if (drawMode === "strafing") {
               drawAxis = nearestAxis(drawAxis, primaryAxes)
            } else if (drawMode === "snapped rotation") {
               drawAxis = nearestAxis(drawAxis, snapAxes)
            }
            if (attach?.object instanceof Segment) {
               let segment = attach.object
               let closestPart = attach.closestPart
               if (segment.axis === drawAxis) {
                  // Cut the segment, and allow the user to move one side of it.
                  let direction = segment.start.displacementFrom(closestPart)
                  let [newStart, other] =
                     direction.dot(dragVector) > 0
                        ? [segment.start, segment.end]
                        : [segment.end, segment.start]
                  let jMove = new Junction(closestPart)
                  let jOther = new Junction(closestPart)
                  let moveSegment = new Segment(newStart, jMove, drawAxis)
                  let otherSegment = new Segment(other, jOther, drawAxis)
                  segment.replaceWith(moveSegment, otherSegment)
                  selected = new ToggleSet([jMove])
                  beginMove("move", { grabbed: jMove, atPart: jMove })
               } else {
                  // Create a T-junction.
                  let junction = new Junction(closestPart)
                  segment.splitAt(junction)
                  beginMove("draw", { start: junction, axis: drawAxis })
               }
            } else if (attach) {
               let vertex = attach.object
               if (
                  vertex instanceof Junction &&
                  shouldExtendTheSegmentAt(vertex, drawAxis)
               ) {
                  // Extend the segment, to match the user's probable intent.
                  selected = new ToggleSet([vertex])
                  beginMove("move", { grabbed: vertex, atPart: vertex })
               } else {
                  let unplugged = false
                  for (let [segment, other] of vertex.edges()) {
                     if (segment.axis !== drawAxis) continue
                     if (other.displacementFrom(vertex).dot(dragVector) <= 0)
                        continue
                     // Unplug this segment from the vertex.
                     let junction = new Junction(vertex)
                     segment.replaceWith(new Segment(other, junction, drawAxis))
                     if (
                        vertex instanceof Junction &&
                        vertex.edges().size === 2
                     ) {
                        vertex.convertToCrossing(crossingMap)
                     }
                     // Allow the user to move the unplugged segment around.
                     selected = new ToggleSet([junction])
                     beginMove("move", { grabbed: junction, atPart: junction })
                     unplugged = true
                     break
                  }
                  if (!unplugged)
                     beginMove("draw", { start: vertex, axis: drawAxis })
               }
            } else
               beginMove("draw", {
                  start: new Junction(mouse.downPosition),
                  axis: drawAxis,
               })
            break
         }
      }
   }
   type DrawInfo = { start: Vertex; axis: Axis }
   type MoveInfo = { grabbed: Grabbable; atPart: Point }
   function beginMove(type: "draw", info: DrawInfo): void
   function beginMove(type: "move", info: MoveInfo): void
   function beginMove(type: "draw" | "move", info: DrawInfo | MoveInfo) {
      let draw
      let partGrabbed
      // For the time being, I am hard-coding the 30px snapping to only occur
      // amongst circuit elements that are oriented horizontally and vertically.
      // If the code below is commented out, then snapping will occur amongst
      // elements whose axis is the same as the element being grabbed.
      let axisGrabbed = Axis.horizontal
      if (type === "draw") {
         info = info as DrawInfo // hack to tell TypeScript the correct type
         // Add the line being drawn to the circuit.
         let end = new Junction(info.start)
         selected = new ToggleSet([end]) // enables the endpoint to be dragged
         let segment = new Segment(info.start, end, info.axis)
         draw = { segment, segmentIsNew: true }
         partGrabbed = end.clone()
         //axisGrabbed = info.axis
      } else {
         info = info as MoveInfo // hack to tell TypeScript the correct type
         partGrabbed = info.atPart.clone()
         // Find the Axis that moved objects should snap along & orthogonal to.
         // if (info.grabbed instanceof Segment) {
         //    axisGrabbed = info.grabbed.axis
         // } else if (info.grabbed instanceof SymbolInstance) {
         //    axisGrabbed = findAxis(Axis.fromDirection(info.grabbed.direction()))
         // } else {
         //    let _
         //    let axis = Axis.horizontal
         //    for ([{ axis }] of info.grabbed.edges) {
         //       // Prefer horizontal and vertical axes.
         //       if (primaryAxes.includes(axis)) break
         //    }
         //    axisGrabbed = axis
         // }
      }
      // Before movement commences, record the position of every Movable.
      // We need to use the original positions as a reference, because we will
      // be mutating them over the course of the movement.
      let originalPositions = new DefaultMap<Movable | Vertex, Point>(
         () => Point.zero
      )
      for (let junction of Junction.s) {
         originalPositions.set(junction, junction.clone())
      }
      for (let symbol of SymbolInstance.s) {
         originalPositions.set(symbol, symbol.position.clone())
         for (let port of symbol.ports)
            originalPositions.set(port, port.clone())
      }
      // If moving a Junction with only one edge, treat the move as a draw.
      if (!draw && selected.size === 1) {
         let end = [...selected][0]
         if (end instanceof Junction && end.edges().size === 1) {
            let [existingSegment, start] = [...end.edges()][0]
            existingSegment = existingSegment as Segment
            start = start as Vertex
            // The existing segment may be "backwards". We need to replace
            // it with a segment whose .end is the vertex being grabbed.
            let segment = new Segment(start, end, existingSegment.axis)
            existingSegment.replaceWith(segment)
            draw = { segment, segmentIsNew: false }
         }
      }
      move = {
         axisGrabbed,
         partGrabbed,
         distance: 0,
         originalPositions,
         draw,
      }
   }
   function updateMove() {
      if (!move || mouse.state === "up") return
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s

      let draw = move.draw
      if (draw && drawMode === "snapped rotation") {
         // Check which axis the mouse is closest to. If the axis has
         // changed, restart the move operation along the new axis.
         let drawVector = mouse.position.displacementFrom(draw.segment.start)
         let newAxis = findAxis(Axis.fromVector(drawVector))
         if (newAxis) {
            // Snap to the nearest standard axis.
            newAxis = nearestAxis(newAxis, snapAxes)
            if (newAxis !== draw.segment.axis) {
               let newEnd = draw.segment.start.displacedBy(
                  drawVector.projectionOnto(newAxis)
               )
               ;(draw.segment.end as Junction).moveTo(newEnd)
               ;(draw.segment.axis as Axis) = newAxis
               // Reset the move operation.
               beginMove("move", {
                  grabbed: draw.segment.end as Junction,
                  atPart: draw.segment.end,
               })
               draw = move.draw
            }
         }
      } else if (draw && drawMode === "free rotation") {
         // To accommodate for the constantly-changing drawing axis,
         // the move operation is restarted from scratch every update.
         function isAcceptableTEMP(vertex: Vertex) {
            if (vertex === draw!.segment.end) return false
            let start = draw!.segment.start
            let drawAxis = findAxis(
               Axis.fromVector(vertex.displacementFrom(start))
            )
            if (!drawAxis) return false
            for (let [{ axis }, other] of vertex.edges()) {
               // Reject if the segment being drawn would overlap this seg.
               if (
                  axis === drawAxis &&
                  other.distanceFrom(start) + 1 <
                     vertex.distanceFrom(start) + other.distanceFrom(vertex)
               )
                  return false
            }
            return true
         }
         let closest = closestNearTo(
            mouse.position,
            Array.from(vertices()).filter(isAcceptableTEMP)
         )
         let newAxis = findAxis(
            Axis.fromVector(
               closest
                  ? closest.object.displacementFrom(draw.segment.start)
                  : mouse.position.displacementFrom(draw.segment.start)
            )
         )
         if (newAxis) {
            let newEnd = closest ? closest.object : mouse.position
            ;(draw.segment.end as Junction).moveTo(newEnd)
            ;(draw.segment.axis as Axis) = newAxis
            // Reset the move operation.
            beginMove("move", {
               grabbed: draw.segment.end as Junction,
               atPart: draw.segment.end,
            })
            draw = move.draw
            if (draw /* This should always be true. */) {
               // Do snapping.
               if (closest) {
                  draw.endObject = closest.object
               } else {
                  let s = closestSegmentNearTo(mouse.position, newAxis)
                  if (s) {
                     ;(draw.segment.end as Junction).moveTo(s.closestPart)
                     draw.endObject = s.object
                  } else {
                     draw.endObject = undefined
                  }
               }
            } else console.warn("move.draw was unexpectedly null.")
         }
      }
      if (draw && drawMode === "free rotation") return

      type Movement = [Vector, Vector]
      // This is a "global variable" throughout the forthcoming operations.
      let movements = new DefaultMap<Movable, Movement>(() => [
         zeroVector,
         zeroVector,
      ])
      let fullMove
      if (
         move.distance < 15 &&
         (!draw || (drawMode === "strafing" && !draw.segmentIsNew))
      ) {
         // The user may have grabbed slightly-away from their target object.
         // If so, gradually pull the object towards the mouse cursor.
         fullMove = mouse.position.displacementFrom(
            mouse.downPosition.interpolatedToward(
               move.partGrabbed,
               move.distance / 15
            )
         )
      } else {
         fullMove = mouse.position.displacementFrom(move.partGrabbed)
      }
      // Firstly, perform a simple movement that tracks the mouse.
      if (draw && drawMode === "snapped rotation") {
         fullMove = fullMove.projectionOnto(draw.segment.axis)
         moveOne(draw.segment.end as Junction, fullMove)
      } else {
         moveSelected(fullMove)
      }
      let snappedToPoint = false
      if (draw && drawMode === "strafing") {
         // Try snapping the moved endpoint to another endpoint nearby.
         function isAcceptableTEMP(vertex: Vertex) {
            let vMove = movements.read(movableAt(vertex))
            if (!vMove[0].add(vMove[1]).approxEquals(zeroVector, 0.001))
               return false
            let start = draw!.segment.start
            for (let [{ axis }, other] of vertex.edges()) {
               // Reject if the segment being drawn would overlap this seg.
               if (
                  axis === draw!.segment.axis &&
                  other.distanceFrom(start) + 1 <
                     vertex.distanceFrom(start) + other.distanceFrom(vertex)
               )
                  return false
            }
            return true
         }
         let closest = closestNearTo(
            draw.segment.end,
            Array.from(vertices()).filter(isAcceptableTEMP)
         )
         if (closest) {
            snappedToPoint = true
            let snappedMove = closest.object.displacementFrom(move.partGrabbed)
            moveSelected(snappedMove)
            draw.endObject = closest.object
         } else {
            draw.endObject = undefined
         }
      }
      if (!snappedToPoint) {
         // Snap axis-aligned objects to a "standardGap" distance apart.
         let snappedMove =
            move.distance === 0
               ? fullMove
               : fullMove.add(computeStandardGapEase())
         if (draw && drawMode === "snapped rotation") {
            snappedMove = snappedMove.projectionOnto(draw.segment.axis)
            moveOne(draw.segment.end as Junction, snappedMove)
         } else {
            moveSelected(snappedMove)
         }
         if (draw) {
            // Try snapping the endpoint to nearby segments.
            let s = closestSegmentNearTo(draw.segment.end, draw.segment.axis)
            if (s) {
               ;(draw.segment.end as Junction).moveTo(s.closestPart)
               draw.endObject = s.object
            } else {
               draw.endObject = undefined
            }
         }
      }

      function setMovement(movable: Movable, vector: Vector) {
         movements.set(movable, vector.inTermsOfBasis(basisAxes.read(movable)))
      }
      function moveOne(m: Movable, vector: Vector) {
         setMovement(m, vector)
         m.moveTo(move!.originalPositions.read(m).displacedBy(vector))
      }
      function moveSelected(movement: Vector) {
         // Reset the position of each Movable. The movement of each Movable is
         // computed relative to its position before the move operation began.
         for (let m of movables()) m.moveTo(move!.originalPositions.read(m))
         movements.clear()
         if (draw) {
            // Under the normal movement rules, occasionally the segment being
            // drawn is not able to have its length changed. Thus when drawing,
            // we "mask out" the lengthwise part of the movement.
            let drawStart = movableAt(draw.segment.start)
            let drawEnd = draw.segment.end as Junction
            setMovement(drawEnd, movement)
            let remainingMovement: Vector
            if (autoSelectedMovables.includes(drawStart)) {
               // draw.segment.start doesn't have a basis. Therefore, we break
               // the movement into parallel and orthogonal components.
               remainingMovement = movement.rejectionFrom(draw.segment.axis)
            } else {
               let basis = basisAxes.read(drawStart)
               let otherAxis = basis[0] === draw.segment.axis ? 1 : 0
               remainingMovement = movement.inTermsOfBasis(basis)[otherAxis]
               // Propagate the remaining movement to drawStart.
               propagateMovement(drawStart, {
                  movable: drawEnd,
                  segment: draw.segment,
                  movement: remainingMovement,
               })
            }
            // Move each auto-selected Movable by the remaining movement.
            for (let movable of autoSelectedMovables) {
               setMovement(movable, remainingMovement)
               for (let [segment, nextVertex] of movable.edges()) {
                  let next = movableAt(nextVertex)
                  if (allSelectedMovables.has(next)) continue
                  propagateMovement(next, {
                     movable,
                     segment,
                     movement: remainingMovement,
                  })
               }
            }
         } else {
            // Do a normal move.
            for (let movable of allSelectedMovables) {
               setMovement(movable, movement)
               for (let [segment, nextVertex] of movable.edges()) {
                  let next = movableAt(nextVertex)
                  if (allSelectedMovables.has(next)) continue
                  propagateMovement(next, { movable, segment, movement })
               }
            }
         }
         // Update the position of each Movable.
         for (let movable of movables()) {
            let movePart = movements.read(movable)
            movable.moveBy(movePart[0].add(movePart[1]))
         }
      }
      function propagateMovement(
         movable: Movable, // The thing we are moving.
         source: { movable: Movable; segment: Segment; movement: Vector }
      ) {
         let forces = forcesAtMovable.read(movable).read(source.segment)
         if (!forces.push && !forces.strafeClock && !forces.strafeAnti) return
         let [sourceVertex, thisVertex] =
            movableAt(source.segment.start) === source.movable
               ? [source.segment.start, source.segment.end]
               : [source.segment.end, source.segment.start]
         let basis = basisAxes.read(movable)
         let part = source.movement.inTermsOfBasis(basis)
         let [push, strafe] = source.segment.axis === basis[0] ? [0, 1] : [1, 0]
         let segmentDisplaced = thisVertex
            .displacedBy(part[strafe])
            .displacementFrom(sourceVertex.displacedBy(source.movement))
         let pushDir = thisVertex.directionFrom(sourceVertex)
         let pushRequired = pushDir?.scaledBy(standardGap).sub(segmentDisplaced)
         if (!pushRequired?.direction()?.approxEquals(pushDir, 0.1))
            pushRequired = undefined
         // Only push if the Movables are meant to push each other, and only
         // push by the amount required to maintain the minimum segment length.
         part[push] = forces.push && pushRequired ? pushRequired : zeroVector
         // If the Movable's movement vector has gotten larger, update it.
         let movePart = movements.getOrCreate(movable)
         let somethingNew = false
         for (let i = 0; i < 2; ++i) {
            if (
               part[i].sqLength() > movePart[i].sqLength() &&
               !part[i].approxEquals(movePart[i], 0.1)
            ) {
               movePart[i] = part[i]
               somethingNew = true
            }
         }
         if (!somethingNew) return
         // Propagate the movement to neighbours.
         for (let [segment, nextVertex] of movable.edges()) {
            let next = movableAt(nextVertex)
            if (segment === source.segment || allSelectedMovables.has(next))
               continue
            let movement = movePart[0].add(movePart[1])
            if (basis.includes(segment.axis)) {
               propagateMovement(next, { movable, segment, movement })
            } else {
               // The segment is outside the basis, but we can move it by
               // strafing all connected parallel segments.
               let toVisit = [next]
               let found = new Set([movable, next])
               while (toVisit.length > 0) {
                  let m = toVisit.pop() as Movable
                  // Apply the strafe component of the movement.
                  let basis_ = basisAxes.read(m)
                  let part_ = movement.inTermsOfBasis(basis_)
                  let [push_, strafe_] =
                     segment.axis === basis_[0] ? [0, 1] : [1, 0]
                  if (m.axes().length === 1) {
                     movements.getOrCreate(m)[strafe_] = part_[strafe_]
                     // In this case, it is safe to push. However, I'd
                     // need to do a big refactoring in order to correctly
                     // _propagate_ pushes along the chain. (I would re-use
                     // the code from the start of the function.)
                  } else {
                     // We can't safely push, so just strafe.
                     movements.getOrCreate(m)[strafe_] = part_[strafe_]
                  }
                  // Keep traversing parallel segments.
                  for (let [s, nextV] of m.edges()) {
                     let nextM = movableAt(nextV)
                     if (s.axis === segment.axis && !found.has(nextM)) {
                        toVisit.push(nextM)
                        found.add(nextM)
                     }
                  }
               }
            }
         }
      }
      function computeStandardGapEase(): Vector {
         return zeroVector
         // The two axes along which this algorithm operates:
         let easeAxes = {
            x: move!.axisGrabbed,
            y: findAxis(move!.axisGrabbed.orthogonal()),
         }
         // Logic for the drawing edge case.
         let drawAxis: "x" | "y" | undefined
         let drawEndSide: "low" | "high" | undefined
         let shouldEase = { x: true, y: true }
         if (draw && drawingSpecialCase) {
            let start = draw.segment.start.relativeTo(easeAxes.x)
            let end = draw.segment.end.relativeTo(easeAxes.x)
            if (draw.segment.axis === easeAxes.x) {
               drawAxis = "x"
               drawEndSide = end.x < start.x ? "low" : "high"
            } else if (draw.segment.axis === easeAxes.y) {
               drawAxis = "y"
               drawEndSide = end.y < start.y ? "low" : "high"
            } else return zeroVector
            shouldEase = { x: drawAxis !== "x", y: drawAxis !== "y" }
         }
         // Output: Whether the Movable can freely move along the given axis.
         function moves(axis: "x" | "y", movable: Movable): boolean {
            let movement = movements.read(movable)
            return (
               movement.type === "full move" ||
               (movement.type === "axis move" &&
                  (movement.moveAxis === easeAxes[axis] ||
                     findAxis(movement.absorbAxis.orthogonal()) ===
                        easeAxes[axis]))
            )
         }
         type SideType = "symbol" | "port" | "junction" | "flank"
         type SideInfo = { type: SideType; value: number; moves: boolean }
         type AxisInfo = { low: SideInfo; high: SideInfo }
         type BoxInfo = { x: AxisInfo; y: AxisInfo }
         // Input: The two opposing corners of an object's bounding box, and
         // the movement info associated with each corner.
         // Output: The position of each side of the box along the two easeAxes,
         // and the manner in which the side can/should move along that axis.
         function boxInfo(thing: Snappable): BoxInfo {
            let a: Point, axType: SideType, ayType: SideType, moveA: Movable
            let b: Point, bxType: SideType, byType: SideType, moveB: Movable
            if (thing instanceof SymbolInstance) {
               let corners = thing.corners()
               a = corners[0].relativeTo(easeAxes.x)
               b = corners[2].relativeTo(easeAxes.x)
               ;[axType, ayType, moveA] = ["symbol", "symbol", thing]
               ;[bxType, byType, moveB] = ["symbol", "symbol", thing]
            } else {
               a = thing.start.relativeTo(easeAxes.x)
               b = thing.end.relativeTo(easeAxes.x)
               axType = ayType =
                  thing.start instanceof Port ? "port" : "junction"
               bxType = byType = thing.end instanceof Port ? "port" : "junction"
               if (a.x === b.x) axType = bxType = "flank"
               if (a.y === b.y) ayType = byType = "flank"
               ;[moveA, moveB] = [movableAt(thing.start), movableAt(thing.end)]
            }
            let axSide = { type: axType, value: a.x, moves: moves("x", moveA) }
            let aySide = { type: ayType, value: a.y, moves: moves("y", moveA) }
            let bxSide = { type: bxType, value: b.x, moves: moves("x", moveB) }
            let bySide = { type: byType, value: b.y, moves: moves("y", moveB) }
            let x =
               a.x <= b.x
                  ? { low: axSide, high: bxSide }
                  : { low: bxSide, high: axSide }
            let y =
               a.y <= b.y
                  ? { low: aySide, high: bySide }
                  : { low: bySide, high: aySide }
            return { x, y }
         }
         // Compute the BoxInfo of each relevant Snappable.
         type Snappable = SymbolInstance | Segment
         let snappables = new Map<Snappable, BoxInfo>()
         for (let symbol of SymbolInstance.s) {
            let axis = findAxis(Axis.fromDirection(symbol.direction()))
            if (axis === easeAxes.x || axis === easeAxes.y)
               snappables.set(symbol, boxInfo(symbol))
         }
         for (let segment of Segment.s) {
            if (segment.axis === easeAxes.x || segment.axis === easeAxes.y)
               snappables.set(segment, boxInfo(segment))
         }
         // Using the details computed above, find the Snappables that are the
         // closest to being "standardGap" apart in each of the axial directions
         type S = Set<[Snappable, Snappable]>
         let minDisp = { x: Infinity, y: Infinity }
         let closestPairs: { x: S; y: S } = { x: new Set(), y: new Set() }
         for (let [thingA, a] of snappables) {
            for (let [thingB, b] of snappables) {
               if (thingA === thingB) continue
               considerAxis("x")
               considerAxis("y")
               function considerAxis(axis: "x" | "y") {
                  let other: "x" | "y" = axis === "x" ? "y" : "x"
                  if (
                     // Are the bounding boxes overlapping along the other axis?
                     a[other].low.value <= b[other].high.value + standardGap &&
                     a[other].high.value >= b[other].low.value - standardGap
                  ) {
                     // Check if thingA can ease towards thingB along this axis.
                     considerSides(axis, "low", "high", true)
                     considerSides(axis, "high", "low", false)
                     if (a[axis].low.type === "junction")
                        considerSides(axis, "low", "low", false)
                     if (b[axis].low.type === "junction")
                        considerSides(axis, "low", "low", true)
                     if (a[axis].high.type === "junction")
                        considerSides(axis, "high", "high", true)
                     if (b[axis].high.type === "junction")
                        considerSides(axis, "high", "high", false)
                  }
               }
               function considerSides(
                  axis: "x" | "y",
                  aSide: "low" | "high",
                  bSide: "low" | "high",
                  flip: boolean
               ) {
                  let condition1 =
                     shouldEase[axis] &&
                     a[axis][aSide].moves &&
                     !b[axis][bSide].moves &&
                     a[axis][aSide].type !== "port" &&
                     b[axis][bSide].type !== "port"
                  let condition2 =
                     thingA === draw?.segment &&
                     a[axis][aSide].type === "junction" &&
                     aSide === drawEndSide
                  if (condition1 || condition2) {
                     let displace = b[axis][bSide].value - a[axis][aSide].value
                     if (flip) {
                        displace += standardGap
                     } else {
                        displace -= standardGap
                     }
                     let shorterBy =
                        Math.abs(minDisp[axis]) - Math.abs(displace)
                     if (shorterBy > 0.01) {
                        minDisp[axis] = displace
                        closestPairs[axis] = new Set([[thingA, thingB]])
                     } else if (shorterBy > -0.01) {
                        closestPairs[axis].add([thingA, thingB])
                     }
                  }
               }
            }
         }
         // Compute the ease vector.
         evaluateDisplacement("x")
         evaluateDisplacement("y")
         function evaluateDisplacement(axis: "x" | "y") {
            if (Math.abs(minDisp[axis]) >= easeRadius /* too far to ease */) {
               minDisp[axis] = 0
               closestPairs[axis] = new Set()
            } else if (Math.abs(minDisp[axis]) >= snapRadius /* ease */) {
               minDisp[axis] =
                  Math.sign(minDisp[axis]) * easeFn(Math.abs(minDisp[axis]))
               closestPairs[axis] = new Set()
            }
         }
         // Express the ease vector in canvas coordinates and return it.
         return new Vector(minDisp.x, minDisp.y).undoRelativeTo(easeAxes.x)
      }
   }
   function endMove(allowedToDelete: boolean = true) {
      if (!move) return
      if (move.draw) {
         let segment = move.draw.segment
         let endObject = move.draw.endObject
         function isAcceptableTEMP() {
            for (let [s, other] of segment.start.edges()) {
               if (
                  s !== segment &&
                  s.axis === segment.axis &&
                  other.distanceFrom(segment.end) + 1 <
                     segment.start.distanceFrom(segment.end) +
                        other.distanceFrom(segment.start)
               )
                  return false
            }
            return true
         }
         if (segment.sqLength() >= sqMinSegmentLength && isAcceptableTEMP()) {
            if (endObject instanceof Segment) {
               // Turn the intersected Segment into a T-junction.
               endObject.splitAt(segment.end as Junction)
            } else if (endObject) {
               let extend =
                  endObject instanceof Junction &&
                  shouldExtendTheSegmentAt(endObject, segment.axis)
               // Replace the drawn segment with one that ends at the Vertex.
               segment.replaceWith(
                  new Segment(segment.start, endObject, segment.axis)
               )
               if (extend)
                  (endObject as Junction).convertToCrossing(crossingMap)
            }
         } else if (allowedToDelete) deleteSelected()
         // Reset the drawing state.
         if (move.draw.segmentIsNew || endObject) selected = new ToggleSet()
      }
      move = null
      if (tool === "draw") selected = new ToggleSet()
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
   }
   function beginRectSelect(start: Point) {
      rectSelect = new Set()
   }
   function updateRectSelect() {
      if (!rectSelect || mouse.state === "up") return
      rectSelect = new Set()
      let range = Range2D.fromCorners(mouse.downPosition, mouse.position)
      // Select enclosed Segments.
      for (let segment of Segment.s) {
         if (range.contains(segment.start) && range.contains(segment.end))
            rectSelect.add(segment)
      }
      // Select enclosed Junctions iff no adjacent Segment is selected.
      next: for (let junction of Junction.s) {
         if (range.contains(junction)) {
            for (let [segment] of junction.edges())
               if (rectSelect.has(segment)) continue next
            rectSelect.add(junction)
         }
      }
      // Select enclosed Symbols.
      for (let symbol of SymbolInstance.s) {
         if (symbol.svgCorners().every((c) => range.contains(c)))
            rectSelect.add(symbol)
      }
   }
   function endRectSelect() {
      if (rectSelect) {
         if (!shift && !alt) selected.clear()
         if (alt) {
            for (let thing of rectSelect) selected.delete(thing)
         } else {
            for (let thing of rectSelect) selected.add(thing)
         }
         selected = selected
      }
      rectSelect = null
   }

   // --------------------- Development-time behaviours -----------------------
   onMount(() => {
      // After a hot reload, the SVGs of symbols must re-inserted into the DOM.
      for (let symbol of SymbolInstance.s) symbol.refresh()
   })
</script>

<svg
   bind:this={canvas}
   style="cursor: {cursor}"
   on:mousedown={(event) => {
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (leftMouseIsDown(event)) leftMouseDown()
   }}
   on:mousemove={(event) => {
      let previousMousePosition = mouse.position
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event) && mouse.state !== "up") {
         if (waitedOneFrame) {
            if (mouse.state === "pressing") leftMousePressEnded(true)
            if (mouse.state === "dragging") leftMouseDragEnded(true)
            waitedOneFrame = false
         } else waitedOneFrame = true
      }
      mouseMoved(previousMousePosition)
   }}
   on:mouseup={(event) => {
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event)) {
         if (mouse.state === "pressing") leftMouseClicked()
         if (mouse.state === "dragging") leftMouseDragEnded()
      }
   }}
   on:mouseenter={(event) => {
      mouse.position = mouseInCoordinateSystemOf(event.currentTarget, event)
      if (!leftMouseIsDown(event)) {
         if (mouse.state === "pressing") leftMousePressEnded(true)
         if (mouse.state === "dragging") leftMouseDragEnded(true)
      }
   }}
>
   <!-- Symbol highlight/selection layer -->
   <g>
      {#each [...SymbolInstance.s] as symbol}
         {@const c = symbol.svgCorners()}
         {#if styleOf(symbol)}
            <polygon
               style="stroke-width: 8px"
               class="symbolHighlight fill stroke {styleOf(symbol)}"
               points="{c[0].x},{c[0].y} {c[1].x},{c[1].y} {c[2].x},{c[2]
                  .y} {c[3].x},{c[3].y}"
            />
         {/if}
      {/each}
   </g>
   <!-- Segment highlight layer -->
   <g>
      {#each [...segmentsToDraw] as [segment, sections]}
         {#if highlighted.has(segment)}
            {#each sections as section}
               <FluidLine renderStyle="hover" segment={section} />
            {/each}
         {/if}
      {/each}
   </g>
   <!-- Segment selection layer -->
   <g>
      {#each [...segmentsToDraw] as [segment, sections]}
         {#if selected.has(segment)}
            {#each sections as section}
               <FluidLine renderStyle="select" segment={section} />
            {/each}
         {/if}
      {/each}
   </g>
   <!-- Segment layer -->
   <g>
      {#each [...segmentsToDraw] as [_, sections]}
         {#each sections as section}
            <FluidLine segment={section} />
         {/each}
      {/each}
   </g>
   <!-- Lower glyph highlight/selection layer -->
   <g>
      {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
         {#if glyph.type === "point marker" && layerOf(glyph.point) === "lower"}
            <PointMarker renderStyle={glyph.style} position={glyph.point} />
         {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "lower"}
            <Plug renderStyle={glyph.style} position={glyph.vertex} />
         {:else if glyph.type === "junction node"}
            <JunctionNode renderStyle={glyph.style} position={glyph.junction} />
         {:else if glyph.type === "hopover"}
            <Hopover
               renderStyle={glyph.style}
               start={glyph.start}
               end={glyph.end}
               flip={glyph.flip}
            />
         {/if}
      {/each}
   </g>
   <!-- Lower glyph layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "point marker" && layerOf(glyph.point) === "lower"}
            <PointMarker position={glyph.point} />
         {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "lower"}
            <Plug position={glyph.vertex} />
         {:else if glyph.type === "junction node"}
            <JunctionNode position={glyph.junction} />
         {:else if glyph.type === "hopover"}
            <Hopover start={glyph.start} end={glyph.end} flip={glyph.flip} />
         {/if}
      {/each}
   </g>
   <!-- Symbol layer -->
   <g id="symbol layer" />
   <!-- Upper glyph highlight/selection layer -->
   <g>
      {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
         {#if glyph.type === "point marker" && layerOf(glyph.point) === "upper"}
            <PointMarker renderStyle={glyph.style} position={glyph.point} />
         {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "upper"}
            <Plug renderStyle={glyph.style} position={glyph.vertex} />
         {/if}
      {/each}
   </g>
   <!-- Upper glyph layer -->
   <g>
      {#each [...glyphsToDraw] as glyph}
         {#if glyph.type === "point marker" && layerOf(glyph.point) === "upper"}
            <PointMarker position={glyph.point} />
         {:else if glyph.type === "plug" && layerOf(glyph.vertex) === "upper"}
            <Plug position={glyph.vertex} />
         {/if}
      {/each}
   </g>
   <!-- HUD layer -->
   <g>
      {#if rectSelect && mouse.state !== "up"}
         <RectSelectBox start={mouse.downPosition} end={mouse.position} />
      {/if}
      {#each [...pushPaths] as [pass, path]}
         <path style="fill:{pass === 1 ? 'purple' : '#cc7a00'}" d={path} />
      {/each}
      {#each [...strafePaths] as [pass, path]}
         <path
            style="stroke-width: 3px; stroke:{pass === 1
               ? 'purple'
               : '#cc7a00'}"
            d={path}
         />
      {/each}
      {#each [...basisPaths] as path}
         <path style="stroke-width: 1px; stroke: white" d={path} />
      {/each}
   </g>
</svg>

<style>
   svg {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
   }
</style>
