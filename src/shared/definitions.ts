import type { Point, Rotation, BoundingBox } from "~/shared/math"

export type Tool = "select & move" | "hydraulic line"
export type SymbolKind = {
   filePath: string
   svgTemplate: SVGElement
   boundingBox: BoundingBox
   snapPoints: Set<Point>
}
export type SymbolInstance = {
   kind: SymbolKind
   svg: SVGElement
   idSuffix: string // added to every ID of the instantiated SVG
   position: Point // where the SVG's origin should be placed on the canvas
   rotation: Rotation
}
