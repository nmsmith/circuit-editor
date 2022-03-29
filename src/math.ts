abstract class VecBase {
   readonly x: number
   readonly y: number
   constructor(x: number, y: number) {
      this.x = x
      this.y = y
   }
   equals(v: this) {
      return this.x == v.x && this.y == v.y
   }
}

export class Vec extends VecBase {
   static readonly zero = new Vec(0, 0)
   sqLength(): number {
      return this.x * this.x + this.y * this.y
   }
   length(): number {
      return Math.sqrt(this.sqLength())
   }
   scaleBy(s: number): Vec {
      return new Vec(s * this.x, s * this.y)
   }
   add(v: Vec): Vec {
      return new Vec(this.x + v.x, this.y + v.y)
   }
   sub(v: Vec): Vec {
      return new Vec(this.x - v.x, this.y - v.y)
   }
   dot(v: Vec): number {
      return this.x * v.x + this.y * v.y
   }
   projectionOnto(v: Vec): Vec {
      return v.scaleBy(this.dot(v) / v.dot(v))
   }
   clone(): Vec {
      return new Vec(this.x, this.y)
   }
}

export class Point extends VecBase {
   static readonly zero = new Point(0, 0)
   sqDistanceFrom(p: Point): number {
      let dx = this.x - p.x
      let dy = this.y - p.y
      return dx * dx + dy * dy
   }
   distanceFrom(p: Point): number {
      return Math.sqrt(this.sqDistanceFrom(p))
   }
   displaceBy(v: Vec): Point {
      return new Point(this.x + v.x, this.y + v.y)
   }
   displacementFrom(p: Point): Vec {
      return new Vec(this.x - p.x, this.y - p.y)
   }
   clone(): Point {
      return new Point(this.x, this.y)
   }
}

// A line with one endpoint.
export class Ray {
   readonly origin: Point
   readonly dir: Vec
   constructor(origin: Point, dir: Vec) {
      this.origin = origin
      this.dir = dir
   }
   intersection(target: Segment): Point | null {
      return genericIntersection(
         target.start,
         target.end,
         this.origin,
         this.origin.displaceBy(this.dir),
         true
      )
   }
}

// A line with two endpoints.
export class Segment {
   readonly start: Point
   readonly end: Point
   constructor(start: Point, end: Point) {
      this.start = start
      this.end = end
   }
   sqLength(): number {
      return this.end.sqDistanceFrom(this.start)
   }
   length(): number {
      return this.end.distanceFrom(this.start)
   }
   intersection(seg: Segment): Point | null {
      return genericIntersection(this.start, this.end, seg.start, seg.end)
   }
   // Returns the endpoints of the segment, plus the specified number of
   // interior points (equally spaced).
   *points(interiorPoints: number) {
      yield this.start
      if (interiorPoints > 0) {
         let d = this.end
            .displacementFrom(this.start)
            .scaleBy(1 / (interiorPoints + 1))
         for (
            let i = 0, p = this.start.displaceBy(d);
            i < interiorPoints;
            ++i, p = p.displaceBy(d)
         ) {
            yield p
         }
      }
      yield this.end
   }
}

// If the flag is false, compute the intersection between two line segments.
// If the flag is true, compute the intersection between a segment and a ray.
function genericIntersection(
   p1: Point,
   p2: Point,
   p3: Point,
   p4: Point,
   rayFrom3to4: boolean = false // Whether to interpret p3 and p4 as a ray
): Point | null {
   let dx12 = p1.x - p2.x
   let dx34 = p3.x - p4.x
   let dx13 = p1.x - p3.x
   let dy12 = p1.y - p2.y
   let dy34 = p3.y - p4.y
   let dy13 = p1.y - p3.y
   let denominator = dx12 * dy34 - dy12 * dx34
   let t = dx13 * dy34 - dy13 * dx34
   let u = dx13 * dy12 - dy13 * dx12
   if (
      (denominator > 0 &&
         t >= 0 &&
         t <= denominator &&
         u >= 0 &&
         (rayFrom3to4 || u <= denominator)) ||
      (denominator < 0 &&
         t <= 0 &&
         t >= denominator &&
         u <= 0 &&
         (rayFrom3to4 || u >= denominator))
   ) {
      t /= denominator
      let x = p1.x - dx12 * t
      let y = p1.y - dy12 * t
      return new Point(x, y)
   } else return null
}
