import {
   rememberAxis,
   forgetAxis,
   Vector,
   Point,
   Rotation,
   Axis,
   Range2D,
   Rectangle,
   Range1D,
} from "~/shared/geometry"
import * as Geometry from "~/shared/geometry"
import { DefaultMap, DefaultWeakMap, ToggleSet } from "./utilities"

let nextObjectID = 0

export type Vertex = Junction | Port
export type VertexGlyphKind =
   | { type: "auto" }
   | { type: "manual"; glyph: string | null }
export function isVertex(thing: any): thing is Vertex {
   return thing instanceof Junction || thing instanceof Port
}

export interface Deletable {
   delete(): Set<Junction> // Returns all Junctions adjacent to the deleted obj.
}

export type Edge = [Segment, Vertex]

export class Junction extends Point implements Deletable {
   static s = new Set<Junction>()
   readonly objectID: number // for serialization
   glyph: VertexGlyphKind
   private readonly edges_ = new Set<Edge>()
   private host_: Segment | SymbolInstance | null = null
   constructor(point: Point, glyph?: VertexGlyphKind) {
      super(point.x, point.y)
      this.objectID = nextObjectID++
      this.glyph = glyph ? glyph : { type: "auto" }
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
      this.detach()
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
   attachTo(host: Segment | SymbolInstance) {
      if (this.host_) this.detach()
      this.host_ = host
      host.attachments.add(this)
   }
   host(): Segment | SymbolInstance | null {
      return this.host_
   }
   detach() {
      if (this.host_) {
         this.host_.attachments.delete(this)
         this.host_ = null
      }
   }
   // If the junction is an X-junction or a straight line, convert it to a
   // crossing. Thereafter, all references to the junction should be discarded.
   convertToCrossing(
      currentCrossings: DefaultMap<Segment, Map<Segment, Crossing>>
   ) {
      if (this.edges_.size !== 2 && this.edges_.size !== 4) return
      // Gather all pairs of colinear edges.
      let ax = new DefaultMap<Axis, Segment[]>(() => [])
      for (let edge of this.edges_) ax.getOrCreate(edge[0].axis).push(edge[0])
      let pairs = new Set<[Segment, Segment]>()
      for (let pair of ax.values()) {
         if (pair.length !== 2) return
         if (pair[0].type !== pair[1].type) return // can't merge diff types
         pairs.add([pair[0], pair[1]])
      }
      // Merge each pair of segments into a single segment.
      // NOTE: We need to make sure that all of the properties that are
      // preserved at segment.replaceWith() are addressed here too.
      let crossing = []
      for (let segs of pairs) {
         let mergedSegment = new Segment(
            segs[0].type,
            this === segs[0].start ? segs[0].end : segs[0].start,
            this === segs[1].start ? segs[1].end : segs[1].start,
            segs[0].axis
         )
         crossing.push(mergedSegment)
         // Compare the orientation of the merged segments to the original segs.
         let seg0D = segs[0].end.displacementFrom(segs[0].start)
         let seg1D = segs[1].end.displacementFrom(segs[1].start)
         let mergedD = mergedSegment.end.displacementFrom(mergedSegment.start)
         let sameFacing = [seg0D.dot(mergedD) > 0, seg1D.dot(mergedD) > 0]
         // Merge the state of the old segments into the new one.
         segs[0].attachments.forEach((a) => a.attachTo(mergedSegment))
         segs[1].attachments.forEach((a) => a.attachTo(mergedSegment))
         mergedSegment.isFrozen = segs[0].isFrozen && segs[1].isFrozen
         for (let group of groups) {
            if (group.items.has(segs[0]) || group.items.has(segs[1]))
               group.items.add(mergedSegment)
         }
         // Merge the crossing types of the old segments into the new one.
         for (let s of Segment.s) {
            let i = currentCrossings.read(s).has(segs[0]) ? 0 : 1
            s.crossingKinds.set(mergedSegment, s.crossingKinds.read(segs[i]))
            let segCrossS = segs[i].crossingKinds.read(s)
            if (segCrossS.type === "auto" || sameFacing[i]) {
               mergedSegment.crossingKinds.set(s, segCrossS)
            } else {
               let not = { left: "right", right: "left" } as const
               mergedSegment.crossingKinds.set(s, {
                  type: "manual",
                  glyph: segCrossS.glyph,
                  facing: not[segCrossS.facing],
               })
            }
         }
         // Get rid of the old segments.
         segs[0].delete()
         segs[1].delete()
      }
      this.delete()
   }
}

export class PortKind extends Point {
   readonly svgID: string
   constructor(svgID: string, x: number, y: number) {
      super(x, y)
      this.svgID = svgID
   }
}

export class Port extends Point {
   static s = new Set<Port>()
   readonly objectID: number // for serialization
   readonly symbol: SymbolInstance
   readonly kind: PortKind
   glyph: VertexGlyphKind
   private readonly edges_ = new Set<Edge>()
   constructor(symbol: SymbolInstance, kind: PortKind, position: Point) {
      super(position.x, position.y)
      this.objectID = nextObjectID++
      this.symbol = symbol
      this.kind = kind
      this.glyph = { type: "auto" }
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
   color: string // CSS color
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
         attaches?: boolean
         crossing?: string // when the first line crosses over this one
         L?: string // when the two line types intersect at an L
         T?: string // when the first line type intersects this one at a T
         X?: string // when the two line types intersect at an X
      }
   }
   attachToAll?: boolean // whether to always attach to target (ie. never split)
}

const tetherLineTypeName = "tether"
export const tetherLineType: LineType = {
   name: tetherLineTypeName,
   color: "black",
   thickness: 1,
   attachToAll: true,
}

export type LineTypeConfig = {
   sidebarOrder: string[]
   keyBindings: {
      [lineType: string | symbol]: string // a map from line type to key binding
   }
}

export class SpecialAttachPoint extends Point {
   readonly object: Segment | SymbolInstance
   constructor(x: number, y: number, object: Segment | SymbolInstance) {
      super(x, y)
      this.object = object
   }
}

export class Segment extends Geometry.LineSegment<Vertex> implements Deletable {
   static s = new Set<Segment>()
   readonly objectID: number // for serialization
   type: LineType
   attachments = new Set<Junction>() // should only be modified from Junction class
   isFrozen = false
   readonly crossingKinds = new DefaultWeakMap<Segment, CrossingGlyphKind>(
      () => {
         return { type: "auto" }
      }
   )
   private readonly edgeS: Edge
   private readonly edgeE: Edge
   constructor(type: LineType, start: Vertex, end: Vertex, axis: Axis) {
      super(start, end, axis)
      this.objectID = nextObjectID++
      this.type = type
      this.edgeS = [this, end]
      this.edgeE = [this, start]

      Segment.s.add(this)
      rememberAxis(this.axis)
      this.start.addEdge(this.edgeS)
      this.end.addEdge(this.edgeE)
   }
   isTether(): boolean {
      return this.type.name === tetherLineTypeName
   }
   isRigid(): boolean {
      return this.isFrozen || (this.isTether() && this.attachments.size > 0)
   }
   private cachedCenterPoint = new SpecialAttachPoint(0, 0, this)
   // A variant of center() that retains extra information.
   centerPoint(): SpecialAttachPoint {
      // The purpose of caching is to ensure that the center point has a
      // consistent object identity for as long as the segment is stationary.
      let point = this.center()
      if (point.sqDistanceFrom(this.cachedCenterPoint) !== 0)
         this.cachedCenterPoint = new SpecialAttachPoint(point.x, point.y, this)
      return this.cachedCenterPoint
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
      this.attachments.forEach((a) => a.detach())
      for (let group of groups) group.items.delete(this)
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
      let thisDisp = this.end.displacementFrom(this.start)
      for (let newSegment of newSegments) {
         let segDisp = newSegment.end.displacementFrom(newSegment.start)
         let sameFacing = thisDisp.dot(segDisp) > 0
         // Copy the state of this segment.
         newSegment.isFrozen = this.isFrozen
         for (let group of groups) {
            if (group.items.has(this)) group.items.add(newSegment)
         }
         // Copy the crossing types associated with this segment.
         for (let s of Segment.s) {
            // Copy how "s" crosses "this".
            s.crossingKinds.set(newSegment, s.crossingKinds.read(this))
            // Copy how "this" crosses "s". The facing might need to be flipped.
            let thisCrossS = this.crossingKinds.read(s)
            if (thisCrossS.type === "auto" || sameFacing) {
               newSegment.crossingKinds.set(s, thisCrossS)
            } else {
               let not = { left: "right", right: "left" } as const
               newSegment.crossingKinds.set(s, {
                  type: "manual",
                  glyph: thisCrossS.glyph,
                  facing: not[thisCrossS.facing],
               })
            }
         }
      }
      // Migrate each attachment to the segment that it is closest to.
      for (let attachment of this.attachments) {
         let segmentsWithDistance = newSegments.map((segment) => {
            return { segment, d: segment.sqDistanceFrom(attachment) }
         })
         let closest = segmentsWithDistance.reduce((prev, curr) =>
            curr.d < prev.d ? curr : prev
         )
         if (closest) attachment.attachTo(closest.segment)
      }
      this.attachments.clear()
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

export type CrossingGlyphKind =
   | { type: "auto" }
   | { type: "manual"; glyph: string | null; facing: "left" | "right" }
export class Crossing extends Geometry.LineSegmentCrossing<Segment> {}
export function convertToJunction(crossing: Crossing) {
   let cutPoint = new Junction(crossing.point)
   crossing.seg1.splitAt(cutPoint)
   crossing.seg2.splitAt(cutPoint)
}

export const strokeHighlightThickness = 5
export const fillHighlightThickness = 5

// A common abstraction for storing the information required to instantiate
// and highlight circuit symbols and glyphs.
export class SymbolKind {
   private static nextKindID = 0
   readonly kindID: string
   readonly fileName: string
   readonly svgTemplate: SVGElement
   readonly highlightTemplate: SVGElement
   readonly svgBox: Range2D
   readonly collisionBox: Range2D
   readonly ports: PortKind[]

   static new(fileName: string, fileContents: string): SymbolKind | undefined {
      let doc = new DOMParser().parseFromString(fileContents, "image/svg+xml")
      let svg = doc.querySelector("svg")
      if (svg instanceof SVGElement) {
         return new SymbolKind(fileName, doc, svg)
      } else {
         console.error(
            `Failed to locate an SVG element within ${fileName}.`,
            `Contents:\n${fileContents}`
         )
      }
   }
   private constructor(fileName: string, doc: Document, svg: SVGElement) {
      this.kindID = ":" + SymbolKind.nextKindID++
      this.fileName = fileName
      this.svgTemplate = svg
      this.svgTemplate.id = fileName
      this.svgTemplate.setAttribute("overflow", "visible") // don't clip
      this.svgTemplate.classList.add("svgTemplate")
      // If the SVG doesn't have a width/height, extract them from its viewBox.
      let widthAttr = svg.getAttribute("width")
      let heightAttr = svg.getAttribute("height")
      let hasWidth = widthAttr && !widthAttr.endsWith("%")
      let hasHeight = heightAttr && !heightAttr.endsWith("%")
      let viewBox = svg.getAttribute("viewBox")
      if ((!hasWidth || !hasHeight) && viewBox) {
         let [x, y, w, h] = viewBox.split(",")
         if (!w || !h) [x, y, w, h] = viewBox.split(" ")
         if (w && h) {
            svg.setAttribute("width", w.trim() + "px")
            svg.setAttribute("height", h.trim() + "px")
         }
      }
      // Add the template to the main document so its size can be measured.
      document.getElementById("symbol templates")?.appendChild(this.svgTemplate)
      // To account for "noise" in the data, we round things down to 0.5.
      function floor(x: number) {
         return Math.floor(x * 2) / 2
      }
      // Compute the bounding box of the whole SVG.
      {
         this.svgTemplate.getBoundingClientRect() // hack to fix Safari bug
         let { x, y, width, height } = this.svgTemplate.getBoundingClientRect()
         this.svgBox = Range2D.fromXY(
            new Range1D([floor(x), floor(x + width)]),
            new Range1D([floor(y), floor(y + height)])
         )
      }
      // Locate the collision box of the symbol.
      let box = this.svgTemplate.querySelector("#collisionBox")
      if (box) {
         let { x, y, width, height } = box.getBoundingClientRect()
         this.collisionBox = Range2D.fromXY(
            new Range1D([floor(x), floor(x + width)]),
            new Range1D([floor(y), floor(y + height)])
         )
      } else {
         this.collisionBox = this.svgBox // a sensible alternative
      }

      // Locate the ports of the symbol.
      this.ports = []
      for (let element of this.svgTemplate.querySelectorAll(
         "[id]:not(defs [id])"
      )) {
         if (element.id.toLowerCase().includes("snap")) {
            // Record this port.
            let { x, y, width, height } = element.getBoundingClientRect()
            this.ports.push(
               new PortKind(
                  element.id,
                  floor(x + width / 2),
                  floor(y + height / 2)
               )
            )
            // Remove it from the DOM - it shouldn't be rendered.
            element.remove()
         }
      }

      // The most complicated part: construct a second SVG element to act as
      // a "highlight" around the original element.
      this.highlightTemplate = this.svgTemplate.cloneNode(true) as SVGElement
      this.highlightTemplate.id = `${fileName}-highlight`
      this.highlightTemplate.setAttribute("overflow", "visible") // don't clip
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
         function hasOpacity0(color: string): boolean {
            let rgba = color.split(",")
            if (rgba.length === 4) {
               return parseFloat(rgba[3]) === 0
            } else if (color[0] === "#") {
               if (color.length === 5) return color[4] === "0"
               else return color.slice(7) === "00"
            } else {
               return color === "transparent"
            }
         }
         let style = window.getComputedStyle(e)
         let noStroke =
            style.stroke === "none" ||
            hasOpacity0(style.stroke) ||
            parseFloat(style.strokeOpacity) === 0 ||
            parseFloat(style.strokeWidth) === 0
         let noFill =
            style.fill === "none" ||
            hasOpacity0(style.fill) ||
            parseFloat(style.fillOpacity) === 0
         if (
            style.display === "none" ||
            e.getAttribute("visibility") === "hidden" || // only check own attr.
            parseFloat(style.opacity) === 0 ||
            (noStroke && noFill) ||
            e.classList.contains("noHighlight")
         ) {
            // The element is invisible, so it shouldn't be used as a highlight.
            e.remove()
         } else {
            let w = noFill ? strokeHighlightThickness : fillHighlightThickness
            // Turn the element into a highlight.
            e.setAttribute("fill", "none")
            e.setAttribute(
               "stroke-width",
               (parseFloat(style.strokeWidth) + w).toString()
            )
            // To stop highlights from "poking out" too far, use a round join.
            e.setAttribute("stroke-linejoin", "round")
            // Inherit the stroke color from an ancestor's "color" prop.
            e.setAttribute("stroke", "currentColor")
         }
      }
      // Namespace IDs to avoid conflicts.
      namespaceIDs(this.svgTemplate, this.kindID)
      namespaceIDs(this.highlightTemplate, this.kindID + "h")
   }
}

export class SymbolInstance extends Rectangle implements Deletable {
   static s: SymbolInstance[] = [] // order corresponds to rendering order
   readonly objectID: number // for serialization
   private static nextInstanceID = 0
   readonly instanceID: string
   readonly kind: SymbolKind
   readonly image: SVGElement
   readonly highlight: SVGElement
   readonly ports: Port[]
   specialAttachPoints: SpecialAttachPoint[] = []
   attachments = new Set<Junction>() // should only be modified from Junction class

   constructor(
      kind: SymbolKind,
      position: Point,
      rotation: Rotation = Rotation.zero,
      scale: Vector = new Vector(1, 1)
   ) {
      super(kind.collisionBox, position, rotation, scale)
      this.objectID = nextObjectID++
      this.instanceID = ":" + SymbolInstance.nextInstanceID++
      this.kind = kind
      this.ports = kind.ports.map(
         (p) => new Port(this, p, this.fromRectCoordinates(p))
      )
      this.specialAttachPoints = this.specialPoints().map(
         (p) => new SpecialAttachPoint(p.x, p.y, this)
      )
      SymbolInstance.s.push(this)

      // Create the SVG for this Symbol.
      let svg = kind.svgTemplate.cloneNode(true) as SVGElement
      namespaceIDs(svg, this.instanceID)
      this.image = document.createElementNS("http://www.w3.org/2000/svg", "g")
      this.image.appendChild(svg)
      document.getElementById("symbol layer")?.appendChild(this.image)
      // Create the SVG for this Symbol's highlight.
      let highlightSvg = kind.highlightTemplate.cloneNode(true) as SVGElement
      namespaceIDs(highlightSvg, this.instanceID)
      this.highlight = document.createElementNS(
         "http://www.w3.org/2000/svg",
         "g"
      )
      this.highlight.appendChild(highlightSvg)
      this.moveTo(position) // Initialize the symbol's DOM elements.
   }
   refresh() {
      // Add the SVG back to the DOM after a hot reload. (only needed for dev.)
      document.getElementById("symbol layer")?.appendChild(this.image)
      document
         .getElementById("symbol amassLight layer")
         ?.appendChild(this.highlight)
   }
   applySendToBack() {
      document.getElementById("symbol layer")?.prepend(this.image)
   }
   applyBringToFront() {
      document.getElementById("symbol layer")?.append(this.image)
   }
   delete(): Set<Junction> {
      SymbolInstance.s.splice(SymbolInstance.s.indexOf(this), 1)
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
      this.attachments.forEach((a) => a.detach())
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
      }) rotate(${this.rotation.toDegrees()}) scale(${this.scale.x}, ${
         this.scale.y
      })`
      this.image.setAttribute("transform", translate)
      this.highlight.setAttribute("transform", translate)
      for (let [i, port] of this.ports.entries()) {
         let p = this.fromRectCoordinates(this.kind.ports[i])
         ;(port.x as number) = p.x
         ;(port.y as number) = p.y
      }
      this.specialAttachPoints = this.specialPoints().map(
         (p) => new SpecialAttachPoint(p.x, p.y, this)
      )
   }
   moveBy(displacement: Vector) {
      this.moveTo(this.position.displacedBy(displacement))
   }
   rotateAround(point: Point, rotation: Rotation) {
      ;(this.rotation as Rotation) = this.rotation.add(rotation)
      this.moveTo(this.position.rotatedAround(point, rotation))
   }
   flip() {
      let offset = new Vector(this.kind.svgBox.width() * this.scale.x, 0)
      ;(this.scale as Vector) = new Vector(-this.scale.x, this.scale.y)
      this.moveBy(offset.rotatedBy(this.rotation))
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

function namespaceIDs(svg: SVGElement, suffix: string) {
   // To prevent the IDs of different instances of a Symbol SVG,
   // namespace the IDs.
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

// Groups that circuit elements can belong to.
export type Interactable = Junction | Port | Crossing | Segment | SymbolInstance
export type Group = { name: string; items: ToggleSet<Interactable> }
export const groups = new Set<Group>()
// The following "group" is not persisted, but is placed here for consistency:
const amassedGroupName = "amassed"
export const amassed: Group = { name: amassedGroupName, items: new ToggleSet() }
groups.add(amassed)

type JunctionJSON = {
   objectID: number
   glyph: VertexGlyphKind
   position: { x: number; y: number }
}

type PortJSON = {
   objectID: number
   svgID: string // represents a PortKind
   glyph: VertexGlyphKind
}

type SegmentJSON = {
   objectID: number
   type: string // must be a LineType.name
   attachments?: number[]
   isFrozen: boolean
   crossingKinds: { segmentID: number; crossing: CrossingGlyphKind }[]
   startID: number
   endID: number
   axis: { x: number; y: number }
}

type SymbolJSON = {
   objectID: number
   fileName: string // represents a SymbolKind
   ports: PortJSON[]
   attachments?: number[]
   // Rectangle data
   position: { x: number; y: number }
   rotation: { x: number; y: number }
   scale: { x: number; y: number }
}

type GroupItem =
   | { type: "crossing"; seg1ID: number; seg2ID: number }
   | { type: "other"; objectID: number }

type GroupJSON = {
   name: string
   items: GroupItem[]
}

export type CircuitJSON = {
   junctions: JunctionJSON[]
   segments: SegmentJSON[]
   symbols: SymbolJSON[]
   groups: GroupJSON[]
}

export const emptyCircuitJSON: CircuitJSON = {
   junctions: [],
   segments: [],
   symbols: [],
   groups: [],
}

// Save the current circuit state to a JSON object.
export function saveToJSON(): CircuitJSON {
   let junctions = [...Junction.s].map((j) => {
      return {
         objectID: j.objectID,
         glyph: j.glyph,
         position: { x: j.x, y: j.y },
      }
   })
   let segments = [...Segment.s].map((s) => {
      let crossingKinds = []
      for (let other of Segment.s) {
         let crossing = s.crossingKinds.read(other)
         if (crossing.type !== "auto") {
            crossingKinds.push({ segmentID: other.objectID, crossing })
         }
      }
      return {
         objectID: s.objectID,
         type: s.type.name,
         attachments: [...s.attachments].map((j) => j.objectID),
         isFrozen: s.isFrozen,
         crossingKinds,
         startID: s.start.objectID,
         endID: s.end.objectID,
         axis: { x: s.axis.x, y: s.axis.y },
      }
   })
   let symbols = [...SymbolInstance.s].map((s) => {
      return {
         objectID: s.objectID,
         fileName: s.kind.fileName,
         ports: s.ports.map((p) => {
            return { objectID: p.objectID, svgID: p.kind.svgID, glyph: p.glyph }
         }),
         attachments: [...s.attachments].map((j) => j.objectID),
         position: { x: s.position.x, y: s.position.y },
         rotation: { x: s.rotation.x, y: s.rotation.y },
         scale: { x: s.scale.x, y: s.scale.y },
      }
   })
   let groups_: GroupJSON[] = [...groups].map((g) => {
      return {
         name: g.name,
         items: [...g.items].map((i) =>
            i instanceof Crossing
               ? {
                    type: "crossing",
                    seg1ID: i.seg1.objectID,
                    seg2ID: i.seg2.objectID,
                 }
               : { type: "other", objectID: i.objectID }
         ),
      }
   })
   return { junctions, segments, symbols, groups: groups_ }
}

// Load the circuit state from a JSON object.
export function loadFromJSON(
   circuit: CircuitJSON,
   symbolKinds: Map<string, SymbolKind>,
   lineTypes: Map<string, LineType>,
   crossingMap: DefaultMap<Segment, Map<Segment, Crossing>>
) {
   ;[...Segment.s].forEach((s) => s.delete()) // to decrement Axis counters
   ;[...SymbolInstance.s].forEach((s) => s.delete()) // to remove DOM elements
   Junction.s = new Set()
   Port.s = new Set()
   Segment.s = new Set()
   SymbolInstance.s = []
   amassed.items = new ToggleSet()
   groups.clear()
   groups.add(amassed)
   let vertexMap = new Map<number, Vertex>()
   let segmentMap = new Map<number, Segment>()
   let symbolMap = new Map<number, SymbolInstance>()
   circuit.junctions.forEach((j) => {
      vertexMap.set(
         j.objectID,
         new Junction(new Point(j.position.x, j.position.y), j.glyph)
      )
   })
   circuit.symbols.forEach((s) => {
      let kind = symbolKinds.get(s.fileName)
      if (kind) {
         // Load the symbol.
         let newSymbol = new SymbolInstance(
            kind,
            new Point(s.position.x, s.position.y),
            new Rotation(s.rotation.x, s.rotation.y),
            new Vector(s.scale.x, s.scale.y)
         )
         symbolMap.set(s.objectID, newSymbol)
         // Load the state of the symbol's ports.
         let portsByID = new Map(newSymbol.ports.map((p) => [p.kind.svgID, p]))
         s.ports.forEach((p) => {
            let port = portsByID.get(p.svgID)
            if (port) {
               port.glyph = p.glyph
               vertexMap.set(p.objectID, port)
            }
         })
         // Load the symbol's attachments.
         for (let id of s.attachments || []) {
            let j = vertexMap.get(id)
            if (!j) {
               console.error(
                  `Failed to find a junction (ID ${id}) attached to a symbol (ID ${s.objectID}).`
               )
            } else {
               ;(j as Junction).attachTo(newSymbol)
            }
         }
      } else {
         console.error(
            `Failed to load a symbol, because the SymbolKind "${s.fileName}" could not be found.`
         )
      }
   })
   // Pass 1: Construct the Segment objects.
   circuit.segments.forEach((s) => {
      let lineType = lineTypes.get(s.type)
      let start = vertexMap.get(s.startID)
      let end = vertexMap.get(s.endID)
      if (!lineType) {
         console.error(
            `Failed to load a segment (ID ${s.objectID}), because the LineType "${s.type}" could not be found.`
         )
      }
      if (!start) {
         console.error(
            `Failed to load a segment (ID ${s.objectID}), because failed to locate its vertex (ID ${s.startID}).`
         )
      }
      if (!end) {
         console.error(
            `Failed to load a segment (ID ${s.objectID}), because failed to locate its vertex (ID ${s.endID}).`
         )
      }
      if (lineType && start && end) {
         let newSegment = new Segment(
            lineType,
            start,
            end,
            Axis.fromVector(new Vector(s.axis.x, s.axis.y)) as Axis
         )
         for (let id of s.attachments || []) {
            let j = vertexMap.get(id)
            if (!j) {
               console.error(
                  `Failed to find a junction (ID ${id}) attached to a segment (ID ${s.objectID}).`
               )
            } else {
               ;(j as Junction).attachTo(newSegment)
            }
         }
         newSegment.isFrozen = s.isFrozen
         segmentMap.set(s.objectID, newSegment)
      }
   })
   // Pass 2: Set the crossing type of each segment pair.
   circuit.segments.forEach((s) => {
      let s1 = segmentMap.get(s.objectID)
      if (!s1) return // Segment may have failed to load.
      for (let crossing of s.crossingKinds) {
         let s2 = segmentMap.get(crossing.segmentID)
         if (!s2) continue // Segment may have failed to load.
         s1.crossingKinds.set(s2, crossing.crossing)
      }
   })
   circuit.groups.forEach((g) => {
      let items = new ToggleSet<Interactable>()
      for (let item of g.items) {
         if (item.type === "crossing") {
            let seg1 = segmentMap.get(item.seg1ID)
            let seg2 = segmentMap.get(item.seg2ID)
            let crossPoint = seg1 && seg2 ? seg1.intersection(seg2) : undefined
            if (seg1 && seg2 && crossPoint) {
               let crossing = new Crossing(seg1, seg2, crossPoint)
               crossingMap.getOrCreate(seg1).set(seg2, crossing)
               items.add(crossing)
            } else {
               console.error(
                  `Failed to assign the crossing of two segments (ID ${item.seg1ID} and ID ${item.seg2ID}) to group "${g.name}" because at least one of these segments does not exist.`
               )
            }
         } else {
            let object =
               vertexMap.get(item.objectID) ||
               segmentMap.get(item.objectID) ||
               symbolMap.get(item.objectID)
            if (object) {
               items.add(object)
            } else {
               console.error(
                  `Failed to assign an object (ID ${item.objectID}) to group "${g.name}" because no object with that ID exists.`
               )
            }
         }
      }
      if (g.name === amassedGroupName) {
         amassed.items = items
      } else {
         groups.add({ name: g.name, items })
      }
   })
}
