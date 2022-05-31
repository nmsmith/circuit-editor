import type { Point, Rotation, Range2D, Rectangle } from "~/shared/math"

export type Tool = "select & move" | "hydraulic line"
export type SymbolKind = {
   filePath: string
   svgTemplate: SVGElement
   boundingBox: Range2D
   snapPoints: Set<Point>
}
export type SymbolInstance = {
   kind: SymbolKind
   svg: SVGElement
   idSuffix: string // added to every ID of the instantiated SVG
   geometry: Rectangle // geometry for the purposes of interaction and collision
}
