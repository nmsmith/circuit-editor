import {
   Vector,
   Point,
   Rotation,
   Direction,
   Range2D,
   Rectangle,
} from "~/shared/geometry"

export type Tool = "select & move" | "hydraulic line"
export interface Moveable {
   moveTo(point: Point): void
   moveBy(displacement: Vector): void
}
export class Junction extends Point implements Moveable {
   // These "move__" methods mutate Points directly, allowing operations such as
   // dragging to be performed without needing to touch the rest of the Circuit.
   constructor(point: Point) {
      super(point.x, point.y)
   }
   moveTo(point: Point) {
      ;(this.x as number) = point.x
      ;(this.y as number) = point.y
   }
   moveBy(displacement: Vector) {
      this.moveTo(this.displacedBy(displacement))
   }
   private f() {} // This stops TypeScript from equating Junctions and Ports.
}
export class Port extends Point implements Moveable {
   symbol: SymbolInstance
   constructor(symbol: SymbolInstance, point: Point) {
      super(point.x, point.y)
      this.symbol = symbol
   }
   moveTo(point: Point) {
      this.symbol.moveTo(point)
   }
   moveBy(displacement: Vector) {
      this.symbol.moveBy(displacement)
   }
}
export type SymbolKind = {
   readonly filePath: string
   readonly svgTemplate: SVGElement
   readonly boundingBox: Range2D
   readonly portLocations: Point[]
}
export class SymbolInstance extends Rectangle implements Moveable {
   readonly kind: SymbolKind
   readonly svg: SVGElement
   readonly idSuffix: string
   readonly ports: Port[]
   private static nextUUID = 0
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
   }
   moveTo(point: Point) {
      ;(this.position.x as number) = point.x
      ;(this.position.y as number) = point.y
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
