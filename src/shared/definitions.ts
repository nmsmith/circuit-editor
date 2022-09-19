import {
   rememberAxis,
   forgetAxis,
   Vector,
   Point,
   Rotation,
   Direction,
   Axis,
   Range2D,
   Rectangle,
   Range1D,
} from "~/shared/geometry"
import * as Geometry from "~/shared/geometry"
import { DefaultMap, DefaultWeakMap } from "./utilities"

export type Vertex = Junction | Port
export type VertexGlyph = null | "auto" | "TODO: name of SVG file"
export function isVertex(thing: any): thing is Vertex {
   return thing instanceof Junction || thing instanceof Port
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
      this.glyph = "auto"
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
   rotateAround(point: Point, rotation: Rotation) {
      this.moveTo(this.rotatedAround(point, rotation))
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
      // NOTE: We need to make sure that all of the properties that are
      // preserved at segment.replaceWith() are addressed here too.
      let crossing = []
      for (let segs of pairs) {
         let mergedSegment = new Segment(
            segs[0].type, // Arbitrarily choose the first segment's type.
            this === segs[0].start ? segs[0].end : segs[0].start,
            this === segs[1].start ? segs[1].end : segs[1].start,
            segs[0].axis
         )
         crossing.push(mergedSegment)
         // Merge the state of the old segments into the new one.
         mergedSegment.isRigid = segs[0].isRigid && segs[1].isRigid
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
      this.glyph = "auto"
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

export type LineType = {
   name: string // name of the JSON file (sans extension)
   // The remaining fields correspond to the contents of the JSON file:
   color: string // hex color
   thickness: number // in pixels
   dasharray?: string // in the format of SVG's stroke-dasharray
   ending?: string // file path
   meeting?: {
      // "lineType" should be the file name (sans file extension) of another
      // line type, and "crossing/L/T/X" should be the file name (including file
      // extension) of the glyph that should appear when a meeting of the
      // respective type occurs. The letters L/T/X refer to the shape of the
      // intersection where the two line types meet.
      [lineType: string | symbol]: {
         crossing?: string // when the first line crosses over this one
         L?: string // when the two line types intersect at an L
         T?: string // when the first line type intersects this one at a T
         X?: string // when the two line types intersect at an X
      }
   }
}
export const LineType = {
   s: new Set<LineType>(), // To mimic what is done with the other classes.
}

export class Segment extends Geometry.LineSegment<Vertex> implements Deletable {
   static s = new Set<Segment>()
   type: LineType
   isRigid = false
   readonly crossingTypes = new DefaultWeakMap<Segment, CrossingType>(
      () => "H up"
   )
   private readonly edgeS: Edge
   private readonly edgeE: Edge
   constructor(type: LineType, start: Vertex, end: Vertex, axis: Axis) {
      super(start, end, axis)
      this.type = type
      this.edgeS = [this, end]
      this.edgeE = [this, start]

      Segment.s.add(this)
      rememberAxis(this.axis)
      this.start.addEdge(this.edgeS)
      this.end.addEdge(this.edgeE)
   }
   updateAxis(newAxis: Axis) {
      forgetAxis(this.axis)
      ;(this.axis as Axis) = newAxis
      rememberAxis(this.axis)
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
      // NOTE: Whatever properties are preserved here, should also be preserved
      // at Junction.convertToCrossing().
      for (let newSegment of newSegments) {
         // Copy the state of this segment.
         newSegment.isRigid = this.isRigid
         // Copy the crossing types associated with this segment.
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
         new Segment(this.type, point, start, axis),
         new Segment(this.type, point, end, axis)
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

export class SymbolKind {
   static s = new Set<SymbolKind>()
   readonly fileName: string
   readonly svgTemplate: SVGElement
   readonly highlightTemplate: SVGElement
   readonly svgBox: Range2D
   readonly collisionBox: Range2D
   readonly portLocations: Point[]

   constructor(fileName: string, fileContents: string) {
      let doc = new DOMParser().parseFromString(fileContents, "image/svg+xml")
      if (!doc?.firstChild || doc.firstChild.nodeName !== "svg") {
         throw `Failed to parse ${fileName}. Contents:\n${fileContents}`
      }
      SymbolKind.s.add(this)

      this.fileName = fileName
      this.svgTemplate = doc.firstChild as SVGElement
      this.svgTemplate.id = fileName
      this.svgTemplate.classList.add("svgTemplate")
      // Add the template to the main document so its size can be measured.
      document.getElementById("symbol templates")?.appendChild(this.svgTemplate)

      // Compute the bounding box of the whole SVG.
      {
         this.svgTemplate.getBoundingClientRect() // hack to fix Safari bug
         let { x, y, width, height } = this.svgTemplate.getBoundingClientRect()
         this.svgBox = Range2D.fromXY(
            new Range1D([x, x + width]),
            new Range1D([y, y + height])
         )
      }

      // Locate the collision box of the symbol.
      let box = doc.getElementById("collisionBox")
      if (box) {
         let { x, y, width, height } = box.getBoundingClientRect()
         this.collisionBox = Range2D.fromXY(
            new Range1D([x, x + width]),
            new Range1D([y, y + height])
         )
      } else {
         this.collisionBox = this.svgBox // a sensible alternative
      }

      // Locate the ports of the symbol.
      this.portLocations = []
      for (let element of this.svgTemplate.querySelectorAll("[id]")) {
         if (element.id.endsWith("Snap")) {
            let { x, y, width, height } = element.getBoundingClientRect()
            this.portLocations.push(new Point(x + width / 2, y + height / 2))
         }
      }

      // The most complicated part: construct a second SVG element to act as
      // a "highlight" around the original element.
      this.highlightTemplate = this.svgTemplate.cloneNode(true) as SVGElement
      this.highlightTemplate.id = `${fileName}-highlight`
      this.highlightTemplate.classList.add("svgTemplate")
      document
         .getElementById("symbol templates")
         ?.appendChild(this.highlightTemplate)
      // Find all the strokeable elements, and turn them into a highlight by
      // assigning them a thick stroke whose color is the highlight color.
      for (let e of this.highlightTemplate.querySelectorAll(
         "circle, ellipse, line, path, polygon, polyline, rect, text, textPath"
      )) {
         // We need to robustly check whether element "e" is actually visible.
         // If it isn't visible, we shouldn't highlight it.
         let stroke = e.getAttribute("stroke")
         let so = e.getAttribute("stroke-opacity")
         let strokeOpacity = so ? parseFloat(so) : 1 // default, per SVG spec
         let sw = e.getAttribute("stroke-width")
         let strokeWidth = sw ? parseFloat(sw) : 1 // default, per SVG spec
         let fill = e.getAttribute("fill")
         let fo = e.getAttribute("fill-opacity")
         let fillOpacity = fo ? parseFloat(fo) : 1
         function hasOpacity0(color: string): boolean {
            let rgba = color.split(",") // I'm not handling rgba() with spaces.
            if (rgba.length === 4) {
               return parseFloat(rgba[3]) === 0
            } else if (color[0] === "#") {
               if (color.length === 5) return color[4] === "0"
               else return color.slice(7) === "00"
            } else {
               return color === "transparent"
            }
         }
         let noStroke =
            !stroke ||
            stroke === "none" ||
            hasOpacity0(stroke) ||
            strokeOpacity === 0 ||
            strokeWidth === 0
         let noFill =
            fill === "none" || (fill && hasOpacity0(fill)) || fillOpacity === 0
         if (
            e.getAttribute("display") === "none" ||
            e.getAttribute("visibility") === "hidden" ||
            parseFloat(e.getAttribute("opacity") as string) === 0 ||
            (noStroke && noFill)
         ) {
            // The element is invisible, so it shouldn't be used as a highlight.
            e.remove()
         } else {
            // Turn the element into a highlight.
            e.setAttribute("fill", "none")
            e.setAttribute(
               "stroke-width",
               (strokeWidth + highlightThickness).toString()
            )
            // To stop highlights from "poking out" too far, use a round join.
            e.setAttribute("stroke-linejoin", "round")
            // Inherit the stroke color from an ancestor's "color" prop.
            e.setAttribute("stroke", "currentColor")
         }
      }
      // When rendering the highlight, ignore its viewbox.
      this.highlightTemplate.setAttribute("overflow", "visible")
   }
}

export const highlightThickness = 5

export class SymbolInstance extends Rectangle implements Deletable {
   static s = new Set<SymbolInstance>()
   private static nextUUID = 0
   readonly kind: SymbolKind
   readonly image: SVGElement
   readonly highlight: SVGElement
   readonly idSuffix: string
   readonly ports: Port[]

   constructor(kind: SymbolKind, position: Point, rotation: Rotation) {
      super(position, rotation, kind.collisionBox)
      this.kind = kind
      this.idSuffix = ":" + SymbolInstance.nextUUID++
      this.ports = kind.portLocations.map(
         (p) => new Port(this, this.fromRectCoordinates(p))
      )
      SymbolInstance.s.add(this)

      // Create the SVG for this Symbol.
      let svg = kind.svgTemplate.cloneNode(true) as SVGElement
      this.namespaceIDs(svg)
      this.image = document.createElementNS("http://www.w3.org/2000/svg", "g")
      this.image.appendChild(svg)
      document.getElementById("symbol layer")?.appendChild(this.image)
      // Create the SVG for this Symbol's highlight.
      let highlightSvg = kind.highlightTemplate.cloneNode(true) as SVGElement
      this.namespaceIDs(highlightSvg, true)
      this.highlight = document.createElementNS(
         "http://www.w3.org/2000/svg",
         "g"
      )
      this.highlight.appendChild(highlightSvg)
   }
   private namespaceIDs(svg: SVGElement, isHighlight?: boolean) {
      // To prevent the IDs of different instances of a Symbol SVG,
      // namespace the IDs.
      let suffix = this.idSuffix + (isHighlight ? "h" : "")
      for (let element of svg.querySelectorAll("[id]")) {
         element.setAttribute("id", element.id + suffix)
      }
      for (let element of svg.querySelectorAll("use")) {
         const xlink = "http://www.w3.org/1999/xlink"
         let ref = element.getAttribute("href")
         let xRef = element.getAttributeNS(xlink, "href")
         if (ref && ref[0] === "#") element.setAttribute("href", ref + suffix)
         else if (xRef && xRef[0] === "#")
            element.setAttributeNS(xlink, "href", xRef + suffix)
      }
   }
   refresh() {
      // Add the SVG back to the DOM after a hot reload. (only needed for dev.)
      document.getElementById("symbol layer")?.appendChild(this.image)
      document
         .getElementById("symbol grabLight layer")
         ?.appendChild(this.highlight)
   }
   delete(): Set<Junction> {
      SymbolInstance.s.delete(this)
      this.image.remove()
      this.highlight.remove()
      for (let port of this.ports) {
         Port.s.delete(port)
         if (port.edges().size > 0) {
            // Convert the Port to a Junction, and replace the Port's segments.
            let junction = new Junction(port)
            for (let [oldSegment, v] of port.edges()) {
               oldSegment.replaceWith(
                  new Segment(oldSegment.type, junction, v, oldSegment.axis)
               )
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
      ;(this.position as Point) = point
      let translate = `translate(${point.x} ${
         point.y
      }) rotate(${this.rotation().toDegrees()})`
      this.image.setAttribute("transform", translate)
      this.highlight.setAttribute("transform", translate)
      for (let [i, port] of this.ports.entries()) {
         let p = this.fromRectCoordinates(this.kind.portLocations[i])
         ;(port.x as number) = p.x
         ;(port.y as number) = p.y
      }
   }
   moveBy(displacement: Vector) {
      this.moveTo(this.position.displacedBy(displacement))
   }
   rotateAround(point: Point, rotation: Rotation) {
      ;(this.direction as Direction) = this.direction.rotatedBy(rotation)
      this.moveTo(this.position.rotatedAround(point, rotation))
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
