import {
   Vector,
   Point,
   Rotation,
   Direction,
   Axis,
   Range2D,
   Rectangle,
} from "~/shared/geometry"
import * as Geometry from "~/shared/geometry"
import { DefaultMap, DefaultWeakMap } from "./utilities"

export type Tool = "select & move" | "hydraulic line"
export type Vertex = Junction | Port
export function isVertex(thing: any): thing is Vertex {
   return thing instanceof Junction || thing instanceof Port
}
export type Edge = [Segment, Vertex]
// Global variable to keep track of:
// • Each Axis that exists
// • How many geometric objects hold a reference to the Axis
// We use this to "merge" axes that are sufficiently close.
const axes = new DefaultMap<Axis, number>(() => 0)
// The error ratio (between 0 and 1) at which two axes should be considered
// parallel. A non-zero tolerance is required to circumvent numerical error.
const axisErrorTolerance = 0.004
export function rememberAxis(axis: Axis) {
   axes.update(axis, (c) => c + 1)
}
export function forgetAxis(axis: Axis) {
   let count = axes.read(axis)
   count > 1 ? axes.set(axis, count - 1) : axes.delete(axis)
}
// Attempt to find an existing Axis close to the given Axis.
export function findAxis(subject: Axis): Axis
export function findAxis(subject: Axis | undefined): Axis | undefined
export function findAxis(subject: Axis | undefined): Axis | undefined {
   if (!subject) return undefined
   for (let axis of axes.keys()) {
      if (subject.approxEquals(axis, axisErrorTolerance)) return axis
   }
   return subject
}

export interface Deletable {
   delete(): Set<Junction> // Returns all Junctions adjacent to the deleted obj.
}
export interface Moveable {
   moveTo(point: Point): void
   moveBy(displacement: Vector): void
}
interface HasEdges {
   addEdge(edge: Edge): void
   deleteEdge(edge: Edge): void
   axes(): Axis[]
}
export class Junction extends Point implements Deletable, Moveable, HasEdges {
   static s = new Set<Junction>()
   readonly edges = new Set<Edge>()
   constructor(point: Point) {
      super(point.x, point.y)
      Junction.s.add(this)
   }
   delete(): Set<Junction> {
      Junction.s.delete(this)
      let neighbours = new Set<Junction>()
      for (let [segment, other] of this.edges) {
         segment.delete()
         if (other instanceof Junction) neighbours.add(other)
      }
      this.edges.clear()
      return neighbours
   }
   moveTo(point: Point) {
      ;(this.x as number) = point.x
      ;(this.y as number) = point.y
   }
   moveBy(displacement: Vector) {
      this.moveTo(this.displacedBy(displacement))
   }
   addEdge(edge: Edge) {
      this.edges.add(edge)
   }
   deleteEdge(edge: Edge) {
      this.edges.delete(edge)
      if (this.edges.size === 0) this.delete()
   }
   axes(): Axis[] {
      let a: Axis[] = []
      for (let [{ axis }] of this.edges) if (!a.includes(axis)) a.push(axis)
      return a
   }
   isStraightLine() {
      return this.edges.size === 2 && this.axes().length === 1
   }
}
export class Port extends Point implements Moveable, HasEdges {
   static s = new Set<Port>()
   readonly symbol: SymbolInstance
   edge: Edge | null
   constructor(symbol: SymbolInstance, point: Point) {
      super(point.x, point.y)
      this.symbol = symbol
      this.edge = null
      Port.s.add(this)
   }
   moveTo(point: Point) {
      this.symbol.moveTo(point)
   }
   moveBy(displacement: Vector) {
      this.symbol.moveBy(displacement)
   }
   addEdge(edge: Edge) {
      this.edge = edge
   }
   deleteEdge(edge: Edge) {
      if (this.edge === edge) this.edge = null
   }
   axes(): Axis[] {
      return this.edge ? [this.edge[0].axis] : []
   }
}
export class Segment extends Geometry.LineSegment<Vertex> implements Deletable {
   static s = new Set<Segment>()
   readonly crossingTypes = new DefaultWeakMap<Segment, CrossingType>(
      () => "H up"
   )
   private readonly edgeS: Edge
   private readonly edgeE: Edge
   constructor(start: Vertex, end: Vertex, axis: Axis) {
      super(start, end, axis)
      this.edgeS = [this, end]
      this.edgeE = [this, start]

      Segment.s.add(this)
      rememberAxis(this.axis)
      this.start.addEdge(this.edgeS)
      this.end.addEdge(this.edgeE)
   }
   delete(): Set<Junction> {
      Segment.s.delete(this)
      forgetAxis(this.axis)
      this.start.deleteEdge(this.edgeS)
      this.end.deleteEdge(this.edgeE)
      let junctions = new Set<Junction>()
      if (this.start instanceof Junction) junctions.add(this.start)
      if (this.end instanceof Junction) junctions.add(this.end)
      return junctions
   }
   moveEndTo(point: Point, newAxis: Axis) {
      this.end.moveTo(point)
      ;(this.axis as Axis) = newAxis
   }
   // Replace this segment with another (or several), transferring all of its
   // properties. Thereafter, the segment should be forgotten.
   replaceWith(...newSegments: Segment[]) {
      for (let newSegment of newSegments) {
         // Transfer the crossing types.
         for (let s of Segment.s) {
            s.crossingTypes.set(newSegment, s.crossingTypes.read(this))
            newSegment.crossingTypes.set(s, this.crossingTypes.read(s))
         }
      }
      this.delete()
   }
   // Split the segment at the given point, which is assumed to lie on the
   // segment. Thereafter, the segment should be forgotten.
   cutAt(point: Junction) {
      let { start, end, axis } = this
      this.replaceWith(
         new Segment(point, start, axis),
         new Segment(point, end, axis)
      )
   }
}
export type CrossingType = "H up" | "H down" | "V left" | "V right" | "no hop"
export class Crossing extends Geometry.LineSegmentCrossing<Segment> {}
export type SymbolKind = {
   readonly filePath: string
   readonly svgTemplate: SVGElement
   readonly boundingBox: Range2D
   readonly portLocations: Point[]
}
export class SymbolInstance extends Rectangle implements Deletable, Moveable {
   static s = new Set<SymbolInstance>()
   private static nextUUID = 0
   readonly kind: SymbolKind
   readonly svg: SVGElement
   readonly idSuffix: string
   readonly ports: Port[]

   constructor(kind: SymbolKind, position: Point, rotation: Rotation) {
      super(position, rotation, kind.boundingBox)
      this.kind = kind
      this.svg = kind.svgTemplate.cloneNode(true) as SVGElement
      this.idSuffix = ":" + SymbolInstance.nextUUID++
      this.ports = kind.portLocations.map(
         (p) => new Port(this, this.fromRectCoordinates(p))
      )
      // Namespace the IDs (since IDs must be unique amongst all instances).
      for (let element of this.svg.querySelectorAll("*")) {
         if (element.hasAttribute("id")) {
            element.setAttribute("id", element.id + this.idSuffix)
         }
         if (element.nodeName === "use") {
            let ref = element.getAttribute("href")
            let xRef = element.getAttribute("xlink:href")
            if (ref && ref[0] === "#")
               element.setAttribute("href", ref + this.idSuffix)
            else if (xRef && xRef[0] === "#")
               element.setAttribute("xlink:href", xRef + this.idSuffix)
         }
      }
      SymbolInstance.s.add(this)
      document.getElementById("symbol layer")?.appendChild(this.svg)
   }
   delete(): Set<Junction> {
      SymbolInstance.s.delete(this)
      this.svg.remove()
      let neighbours = new Set<Junction>()
      for (let port of this.ports) {
         Port.s.delete(port)
         if (port.edge) {
            if (port.edge[1] instanceof Junction) neighbours.add(port.edge[1])
            port.edge = null
         }
      }
      return neighbours
   }
   moveTo(point: Point) {
      ;(this.position.x as number) = point.x
      ;(this.position.y as number) = point.y
      this.svg.setAttribute("x", point.x.toString())
      this.svg.setAttribute("y", point.y.toString())
      for (let [i, port] of this.ports.entries()) {
         let p = this.fromRectCoordinates(this.kind.portLocations[i])
         ;(port.x as number) = p.x
         ;(port.y as number) = p.y
      }
   }
   moveBy(displacement: Vector) {
      this.moveTo(this.position.displacedBy(displacement))
   }
   direction(): Direction {
      return Direction.positiveX.rotatedBy(this.rotation)
   }
   svgCorners(): Point[] {
      let { x, y, width, height } = this.svg.getBoundingClientRect()
      return [
         new Point(x, y),
         new Point(x + width, y),
         new Point(x + width, y + height),
         new Point(x, y + height),
      ]
   }
}
