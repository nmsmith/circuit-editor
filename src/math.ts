abstract class VectorBase {
   readonly x: number
   readonly y: number
   constructor(x: number, y: number) {
      this.x = x
      this.y = y
   }
   approxEquals(v: this, absoluteError: number) {
      return (
         v.x - absoluteError <= this.x &&
         v.x + absoluteError >= this.x &&
         v.y - absoluteError <= this.y &&
         v.y + absoluteError >= this.y
      )
   }
}

export class Vector extends VectorBase {
   static readonly zero = new Vector(0, 0)
   sqLength(): number {
      return this.x * this.x + this.y * this.y
   }
   length(): number {
      return Math.sqrt(this.sqLength())
   }
   scaleBy(s: number): Vector {
      return new Vector(s * this.x, s * this.y)
   }
   add(v: Vector): Vector {
      return new Vector(this.x + v.x, this.y + v.y)
   }
   sub(v: Vector): Vector {
      return new Vector(this.x - v.x, this.y - v.y)
   }
   dot(v: Vector): number {
      return this.x * v.x + this.y * v.y
   }
   projectionOnto(v: Vector): Vector {
      return v.scaleBy(this.dot(v) / v.dot(v))
   }
   scalarProjectionOnto(v: Vector): number {
      return this.dot(v) / v.length()
   }
}

function mod(x: number, y: number) {
   return ((x % y) + y) % y
}

// We encode an axis as a unit vector with an angle between 0 and 180.
export class Axis extends Vector {
   static readonly horizontal = new Axis(1, 0)
   static readonly vertical = new Axis(0, 1)
   private constructor(x: number, y: number) {
      super(x, y)
   }
   static fromAngle(radians: number): Axis {
      // Ensure the angle is between 0 and 180.
      radians = mod(radians, Math.PI)
      return new Axis(Math.cos(radians), Math.sin(radians))
   }
   static fromVector(vec: Vector): Axis {
      if (vec.y >= 0) {
         let v = vec.scaleBy(1 / vec.length())
         return new Axis(v.x, v.y)
      } else {
         let v = vec.scaleBy(-1 / vec.length())
         return new Axis(v.x, v.y)
      }
   }
   approxEquals(a: this, errorRatio: number): boolean {
      return (
         super.approxEquals(a, errorRatio) ||
         super.approxEquals(a.scaleBy(-1) as this, errorRatio)
      )
   }
}

export class Point extends VectorBase {
   static readonly zero = new Point(0, 0)
   sqDistanceFrom(p: Point): number {
      let dx = this.x - p.x
      let dy = this.y - p.y
      return dx * dx + dy * dy
   }
   distanceFrom(p: Point): number {
      return Math.sqrt(this.sqDistanceFrom(p))
   }
   displaceBy(v: Vector): Point {
      return new Point(this.x + v.x, this.y + v.y)
   }
   displacementFrom(p: Point): Vector {
      return new Vector(this.x - p.x, this.y - p.y)
   }
   clone(): Point {
      return new Point(this.x, this.y)
   }
   // These "move" operations are the only operations that mutate points.
   // If we have these operations, we can implement circuit manipulations such
   // as dragging without having to mutate the circuit data structure itself.
   moveTo(x: number, y: number): void {
      ;(this.x as number) = x
      ;(this.y as number) = y
   }
   moveBy(v: Vector): void {
      ;(this.x as number) += v.x
      ;(this.y as number) += v.y
   }
}

// A line of infinite length.
export class Line {
   readonly origin: Point
   readonly axis: Axis
   constructor(origin: Point, axis: Vector) {
      this.origin = origin
      this.axis = axis
   }
   sqDistanceFrom(point: Point): number {
      let d = point.displacementFrom(this.origin)
      return d.sub(d.projectionOnto(this.axis)).sqLength()
   }
   distanceFrom(point: Point): number {
      return Math.sqrt(this.sqDistanceFrom(point))
   }
}

// A line that extends infinitely in (only) one direction.
export class Ray {
   readonly origin: Point
   readonly direction: Vector
   constructor(origin: Point, dir: Vector) {
      this.origin = origin
      this.direction = dir
   }
   intersection(target: Segment): Point | null {
      return genericIntersection(
         target.start,
         target.end,
         this.origin,
         this.origin.displaceBy(this.direction),
         true
      )
   }
   sqDistanceFrom(point: Point): number {
      let d = point.displacementFrom(this.origin)
      let projection = d.projectionOnto(this.direction)
      if (
         Math.sign(projection.x) === Math.sign(this.direction.x) &&
         Math.sign(projection.y) === Math.sign(this.direction.y)
      ) {
         return d.sub(projection).sqLength()
      } else {
         return projection.sqLength() + d.sub(projection).sqLength()
      }
   }
   distanceFrom(point: Point): number {
      return Math.sqrt(this.sqDistanceFrom(point))
   }
}

// A line segment.
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
