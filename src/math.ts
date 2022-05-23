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
   sqLength(): number {
      return this.x * this.x + this.y * this.y
   }
   length(): number {
      return Math.sqrt(this.sqLength())
   }
   scaledBy(s: number): Vector {
      return new Vector(s * this.x, s * this.y)
   }
   normalized(): Vector {
      return this.scaledBy(1 / this.length())
   }
   add(v: Vector): Vector {
      return new Vector(this.x + v.x, this.y + v.y)
   }
   sub(v: Vector): Vector {
      return new Vector(this.x - v.x, this.y - v.y)
   }
   // Rotate the vector by the given angle.
   // The angle can either be provided as radians, or as an Axis object.
   addRotation(angle: number | Axis): Vector {
      let [cos, sin] =
         angle instanceof Axis
            ? [angle.x, angle.y]
            : [Math.cos(angle), Math.sin(angle)]
      let x = this.x
      let y = this.y
      return new Vector(cos * x - sin * y, sin * x + cos * y)
   }
   subRotation(angle: number | Axis): Vector {
      let [cos, sin] =
         angle instanceof Axis
            ? [angle.x, angle.y]
            : [Math.cos(angle), Math.sin(angle)]
      let x = this.x
      let y = this.y
      return new Vector(cos * x + sin * y, -sin * x + cos * y)
   }
   dot(v: Vector): number {
      return this.x * v.x + this.y * v.y
   }
   projectionOnto(v: Vector): Vector {
      return v.scaledBy(this.dot(v) / v.dot(v))
   }
   scalarProjectionOnto(v: Vector): number {
      return this.dot(v) / v.length()
   }
   rejectionFrom(v: Vector): Vector {
      return this.sub(this.projectionOnto(v))
   }
   scalarRejectionFrom(v: Vector): number {
      return (this.y * v.x - this.x * v.y) / v.length()
   }
}

function mod(x: number, y: number) {
   return ((x % y) + y) % y
}

// We encode an axis as a unit vector with an angle in [-90°, 90°).
export class Axis extends Vector {
   static readonly horizontal = new Axis(1, 0)
   static readonly vertical = new Axis(0, -1)
   private constructor(x: number, y: number) {
      super(x, y)
   }
   static fromAngle(radians: number): Axis {
      // Ensure the angle is in [-90°, 90°).
      const quarterTurn = Math.PI / 2
      radians = mod(radians + quarterTurn, Math.PI) - quarterTurn
      return new Axis(Math.cos(radians), Math.sin(radians))
   }
   static fromVector(vec: Vector): Axis | undefined {
      if (vec.x === 0 && vec.y === 0) {
         return undefined
      } else if (vec.x > 0 || (vec.x === 0 && vec.y < 0)) {
         let v = vec.scaledBy(1 / vec.length())
         return new Axis(v.x, v.y)
      } else {
         let v = vec.scaledBy(-1 / vec.length())
         return new Axis(v.x, v.y)
      }
   }
   orthogonal(): Axis {
      return this.y >= 0 ? new Axis(this.y, -this.x) : new Axis(-this.y, this.x)
   }
   approxEquals(a: this, errorRatio: number): boolean {
      return (
         super.approxEquals(a, errorRatio) ||
         super.approxEquals(a.scaledBy(-1) as this, errorRatio)
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
   displacementFrom(p: Point): Vector {
      return new Vector(this.x - p.x, this.y - p.y)
   }
   directionFrom(p: Point): Vector {
      return this.displacementFrom(p).normalized()
   }
   displacedBy(v: Vector): Point {
      return new Point(this.x + v.x, this.y + v.y)
   }
   clone(): Point {
      return new Point(this.x, this.y)
   }
   // These "move" operations are the only operations that mutate points.
   // If we have these operations, we can implement circuit manipulations such
   // as dragging without having to mutate the circuit data structure itself.
   moveTo(p: Point): void {
      ;(this.x as number) = p.x
      ;(this.y as number) = p.y
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
   constructor(origin: Point, axis: Axis) {
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
   intersection(line: Line): Point | null {
      let grad1 = this.axis.y / this.axis.x
      let grad2 = line.axis.y / line.axis.x
      let intercept1 = this.origin.y - grad1 * this.origin.x
      let intercept2 = line.origin.y - grad2 * line.origin.x
      if (grad1 === grad2) return null
      else if (!isFinite(grad1)) {
         return new Point(this.origin.x, grad2 * this.origin.x + intercept2)
      } else if (!isFinite(grad2)) {
         return new Point(line.origin.x, grad1 * line.origin.x + intercept1)
      } else {
         let x = (intercept2 - intercept1) / (grad1 - grad2)
         return new Point(x, grad1 * x + intercept1)
      }
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
         this.origin.displacedBy(this.direction),
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
   // Whether the given point projects onto the ray.
   shadowedBy(point: Point): boolean {
      return point.displacementFrom(this.origin).dot(this.direction) >= 0
   }
}

// A line segment.
export class Segment {
   static readonly zero = new Segment(Point.zero, Point.zero, Axis.horizontal)
   readonly start: Point
   readonly end: Point
   readonly axis: Axis
   constructor(start: Point, end: Point, axis: Axis) {
      this.start = start
      this.end = end
      this.axis = axis
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
   // Whether the given point projects onto the line segment.
   shadowedBy(point: Point): boolean {
      let dot = point
         .displacementFrom(this.start)
         .dot(this.end.displacementFrom(this.start))
      return dot >= 0 && dot <= this.sqLength()
   }
   // Returns the point that is the given fraction of the way along the
   // segment, where 0 is segment.start and 1 is segment.end.
   pointAt(frac: number): Point {
      return this.start.displacedBy(
         this.end.displacementFrom(this.start).scaledBy(frac)
      )
   }
   // Returns the endpoints of the segment, plus the specified number of
   // interior points (equally spaced).
   *points(interiorPoints: number): Generator<Point> {
      yield this.start
      if (interiorPoints > 0) {
         let d = this.end
            .displacementFrom(this.start)
            .scaledBy(1 / (interiorPoints + 1))
         for (
            let i = 0, p = this.start.displacedBy(d);
            i < interiorPoints;
            ++i, p = p.displacedBy(d)
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

export type Padding = {
   left: number
   right: number
   top: number
   bottom: number
}
export class Box {
   origin: Point
   direction: Vector
   padding: Padding
   constructor(origin: Point, axis: Axis, padding: Padding) {
      this.origin = origin
      this.direction = axis
      this.padding = padding
   }
   static fromPaddedPoint(origin: Point, axis: Axis, padding: Padding): Box {
      return new Box(origin, axis, padding)
   }
   static fromPaddedSegment(segment: Segment, padding: Padding) {
      let length = segment.length()
      let pointPadding = {
         left: padding.left + length / 2,
         right: padding.right + length / 2,
         top: padding.top,
         bottom: padding.bottom,
      }
      return new Box(segment.pointAt(0.5), segment.axis, pointPadding)
   }
   *corners() {
      let cos = this.direction.x
      let sin = this.direction.y
      // top left
      yield this.origin.displacedBy(
         new Vector(
            cos * -this.padding.left - sin * -this.padding.top,
            sin * -this.padding.left + cos * -this.padding.top
         )
      )
      // top right
      yield this.origin.displacedBy(
         new Vector(
            cos * this.padding.right - sin * -this.padding.top,
            sin * this.padding.right + cos * -this.padding.top
         )
      )
      // bottom right
      yield this.origin.displacedBy(
         new Vector(
            cos * this.padding.right - sin * this.padding.bottom,
            sin * this.padding.right + cos * this.padding.bottom
         )
      )
      // bottom left
      yield this.origin.displacedBy(
         new Vector(
            cos * -this.padding.left - sin * this.padding.bottom,
            sin * -this.padding.left + cos * this.padding.bottom
         )
      )
   }
}
