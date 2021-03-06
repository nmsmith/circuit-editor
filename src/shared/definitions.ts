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

export type Vertex = Junction | Port
export type VertexGlyph = "default" | "plug"
export function isVertex(thing: any): thing is Vertex {
   return thing instanceof Junction || thing instanceof Port
}

// We use a global variable to keep track of the Axes that the circuit elements
// in the scene "identify with", and the quantity thereof.
const axes = new DefaultMap<Axis, number>(() => 0)
export function rememberAxis(axis: Axis) {
   axes.update(axis, (c) => c + 1)
}
export function forgetAxis(axis: Axis) {
   let count = axes.read(axis)
   count > 1 ? axes.set(axis, count - 1) : axes.delete(axis)
}
// The error ratio (∈ [0, 1]) at which two axes should be considered parallel.
const axisErrorTolerance = 0.00001
// Find an Axis in the scene that has approx. the same value as the given Axis.
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

export type Edge = [Segment, Vertex]

export class Junction extends Point implements Deletable {
   static s = new Set<Junction>()
   glyph: VertexGlyph
   private readonly edges_ = new Set<Edge>()
   constructor(point: Point) {
      super(point.x, point.y)
      this.glyph = "default"
      Junction.s.add(this)
   }
   delete(): Set<Junction> {
      Junction.s.delete(this)
      let neighbours = new Set<Junction>()
      for (let [segment, other] of this.edges_) {
         segment.delete()
         if (other instanceof Junction) neighbours.add(other)
      }
      this.edges_.clear()
      return neighbours
   }
   moveTo(point: Point) {
      ;(this.x as number) = point.x
      ;(this.y as number) = point.y
   }
   moveBy(displacement: Vector) {
      this.moveTo(this.displacedBy(displacement))
   }
   edges(): Set<Edge> {
      return this.edges_
   }
   axes(): Axis[] {
      let a: Axis[] = []
      for (let [{ axis }] of this.edges_) if (!a.includes(axis)) a.push(axis)
      return a
   }
   addEdge(edge: Edge) {
      this.edges_.add(edge)
   }
   removeEdge(edge: Edge) {
      this.edges_.delete(edge)
      if (this.edges_.size === 0) this.delete()
   }
   isStraightLine() {
      return this.edges_.size === 2 && this.axes().length === 1
   }
   // If the junction is an X-junction or a straight line, convert it to a
   // crossing. Thereafter, all references to the junction should be discarded.
   convertToCrossing(
      currentCrossings: DefaultMap<Segment, Map<Segment, Point>>,
      crossingType?: CrossingType
   ) {
      if (this.edges_.size !== 2 && this.edges_.size !== 4) return
      // Gather all pairs of colinear edges.
      let ax = new DefaultMap<Axis, Segment[]>(() => [])
      for (let edge of this.edges_) ax.getOrCreate(edge[0].axis).push(edge[0])
      let pairs = new Set<[Segment, Segment]>()
      for (let pair of ax.values()) {
         if (pair.length !== 2) return
         pairs.add([pair[0], pair[1]])
      }
      // Merge each pair of segments into a single segment.
      let crossing = []
      for (let segs of pairs) {
         let mergedSegment = new Segment(
            this === segs[0].start ? segs[0].end : segs[0].start,
            this === segs[1].start ? segs[1].end : segs[1].start,
            segs[0].axis
         )
         crossing.push(mergedSegment)
         // Merge the crossing types of the old segments into the new one.
         let seg0Crossings = currentCrossings.read(segs[0])
         for (let s of Segment.s) {
            let type = segs[seg0Crossings.has(s) ? 0 : 1].crossingTypes.read(s)
            mergedSegment.crossingTypes.set(s, type)
            s.crossingTypes.set(mergedSegment, type)
         }
         // Get rid of the old segments.
         segs[0].delete()
         segs[1].delete()
      }
      if (crossing.length === 2 && crossingType) {
         // Set the crossing type of the crossing itself.
         crossing[0].crossingTypes.set(crossing[1], crossingType)
         crossing[1].crossingTypes.set(crossing[0], crossingType)
      }
      this.delete()
   }
}

export class Port extends Point {
   static s = new Set<Port>()
   readonly symbol: SymbolInstance
   glyph: VertexGlyph
   private readonly edges_ = new Set<Edge>()
   constructor(symbol: SymbolInstance, point: Point) {
      super(point.x, point.y)
      this.symbol = symbol
      this.glyph = "default"
      Port.s.add(this)
   }
   edges(): Set<Edge> {
      return this.edges_
   }
   axes(): Axis[] {
      let a: Axis[] = []
      for (let [{ axis }] of this.edges_) if (!a.includes(axis)) a.push(axis)
      return a
   }
   addEdge(edge: Edge) {
      this.edges_.add(edge)
   }
   removeEdge(edge: Edge) {
      this.edges_.delete(edge)
   }
}

export class Segment extends Geometry.LineSegment<Vertex> implements Deletable {
   static s = new Set<Segment>()
   isFrozen = false
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
      this.start.removeEdge(this.edgeS)
      this.end.removeEdge(this.edgeE)
      let junctions = new Set<Junction>()
      if (this.start instanceof Junction) junctions.add(this.start)
      if (this.end instanceof Junction) junctions.add(this.end)
      return junctions
   }
   // Replace this segment with another (or several), transferring all of its
   // properties. Thereafter, all references to the segment should be discarded.
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
   // segment. Thereafter, all references to the segment should be discarded.
   splitAt(point: Junction) {
      let { start, end, axis } = this
      this.replaceWith(
         new Segment(point, start, axis),
         new Segment(point, end, axis)
      )
   }
}

export type CrossingType = "H up" | "H down" | "V left" | "V right" | "no hop"
export class Crossing extends Geometry.LineSegmentCrossing<Segment> {}
export function convertToJunction(crossing: Crossing) {
   let cutPoint = new Junction(crossing.point)
   crossing.seg1.splitAt(cutPoint)
   crossing.seg2.splitAt(cutPoint)
}

export type SymbolKind = {
   readonly filePath: string
   readonly svgTemplate: SVGElement
   readonly svgBox: Range2D
   readonly collisionBox: Range2D
   readonly portLocations: Point[]
}

export class SymbolInstance extends Rectangle implements Deletable {
   static s = new Set<SymbolInstance>()
   private static nextUUID = 0
   readonly kind: SymbolKind
   readonly svg: SVGElement
   readonly idSuffix: string
   readonly ports: Port[]

   constructor(kind: SymbolKind, position: Point, rotation: Rotation) {
      super(position, rotation, kind.collisionBox)
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
            let xlink = "http://www.w3.org/1999/xlink"
            let ref = element.getAttribute("href")
            let xRef = element.getAttributeNS(xlink, "href")
            if (ref && ref[0] === "#")
               element.setAttribute("href", ref + this.idSuffix)
            else if (xRef && xRef[0] === "#")
               element.setAttributeNS(xlink, "href", xRef + this.idSuffix)
         }
      }
      SymbolInstance.s.add(this)
      document.getElementById("symbol layer")?.appendChild(this.svg)
   }
   refresh() {
      // Add the SVG back to the DOM after a hot reload. (only needed for dev.)
      document.getElementById("symbol layer")?.appendChild(this.svg)
   }
   delete(): Set<Junction> {
      SymbolInstance.s.delete(this)
      this.svg.remove()
      for (let port of this.ports) {
         Port.s.delete(port)
         if (port.edges().size > 0) {
            // Convert the Port to a Junction, and replace the Port's segments.
            let junction = new Junction(port)
            for (let [oldSegment, v] of port.edges()) {
               oldSegment.replaceWith(new Segment(junction, v, oldSegment.axis))
            }
            port.edges().clear()
         }
      }
      return new Set()
   }
   edges(): Set<Edge> {
      return new Set(this.ports.flatMap((p) => [...p.edges()]))
   }
   axes(): Axis[] {
      let a: Axis[] = []
      for (let [{ axis }] of this.edges()) if (!a.includes(axis)) a.push(axis)
      return a
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
      let { x, y } = this.kind.svgBox
      return [
         new Point(x.low, y.low),
         new Point(x.high, y.low),
         new Point(x.high, y.high),
         new Point(x.low, y.high),
      ].map((p) => this.fromRectCoordinates(p))
   }
}
