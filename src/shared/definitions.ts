import type { Point, Range2D, Rectangle } from "~/shared/math"

export type Tool = "select & move" | "hydraulic line"
export type SymbolKind = {
   readonly filePath: string
   readonly svgTemplate: SVGElement
   readonly boundingBox: Range2D
   readonly snapPoints: Point[]
}
export class SymbolInstance {
   readonly kind: SymbolKind
   readonly svg: SVGElement
   readonly idSuffix: string // added to every ID of the instantiated SVG
   readonly snapPoints: Point[]
   private readonly geometry: Rectangle // for collisions and interactions
   constructor(
      kind: SymbolKind,
      svg: SVGElement,
      idSuffix: string,
      geometry: Rectangle
   ) {
      this.kind = kind
      this.svg = svg
      this.idSuffix = idSuffix
      this.snapPoints = kind.snapPoints.map((point) =>
         geometry.fromRectCoordinates(point)
      )
      this.geometry = geometry
   }
   moveTo(point: Point) {
      this.geometry.position.moveTo(point)
      for (let [i, p] of this.snapPoints.entries()) {
         p.moveTo(this.geometry.fromRectCoordinates(this.kind.snapPoints[i]))
      }
   }
}
