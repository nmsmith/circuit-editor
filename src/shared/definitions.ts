import { Point, Rotation, Range2D, Rectangle } from "~/shared/math"

export type Tool = "select & move" | "hydraulic line"
export type SymbolKind = {
   readonly filePath: string
   readonly svgTemplate: SVGElement
   readonly boundingBox: Range2D
   readonly ports: Point[]
}
export class SymbolInstance extends Rectangle {
   readonly kind: SymbolKind
   readonly svg: SVGElement
   readonly idSuffix: string
   readonly ports: Point[]
   private static nextUUID = 0
   constructor(kind: SymbolKind, position: Point, rotation: Rotation) {
      super(position, rotation, kind.boundingBox)
      this.kind = kind
      this.svg = kind.svgTemplate.cloneNode(true) as SVGElement
      this.idSuffix = ":" + SymbolInstance.nextUUID++
      this.ports = kind.ports.map((p) => this.fromRectCoordinates(p))
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
   }
   moveTo(point: Point) {
      this.position.moveTo(point)
      for (let [i, p] of this.ports.entries()) {
         p.moveTo(this.fromRectCoordinates(this.kind.ports[i]))
      }
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
