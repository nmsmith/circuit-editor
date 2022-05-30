import type { Vector, Point, Padding } from "~/shared/math"

export type Tool = "select & move" | "hydraulic line"
export type SymbolKind = {
   filePath: string
   svgTemplate: SVGElement
   //boundingBox: Padding
   snapPoints: Set<Point>
}
export type SymbolInstance = {
   kind: SymbolKind
   svg: SVGElement
   idSuffix: string // added to every ID of the instantiated SVG
   // position: Point // where the SVG's origin should be placed on the canvas
   // orientation: Vector // how the symbol should be rotated ((1, 0) = none)
}
