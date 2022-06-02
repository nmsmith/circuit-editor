export abstract class Object2D {
   abstract partClosestTo(point: Point): Point
   sqDistanceFrom(point: Point): number {
      return this.partClosestTo(point).sqDistanceFrom(point)
   }
   distanceFrom(point: Point): number {
      return Math.sqrt(this.sqDistanceFrom(point))
   }
}

export class Vector {
   readonly x: number
   readonly y: number
   constructor(x: number, y: number) {
      this.x = x
      this.y = y
   }
   sqLength(): number {
      return this.x * this.x + this.y * this.y
   }
   length(): number {
      return Math.sqrt(this.sqLength())
   }
   scaledBy(factor: number): Vector {
      return new Vector(factor * this.x, factor * this.y)
   }
   normalized(): Vector | undefined {
      let length = this.length()
      if (length > 0) return this.scaledBy(1 / length)
   }
   add(v: Vector): Vector {
      return new Vector(this.x + v.x, this.y + v.y)
   }
   sub(v: Vector): Vector {
      return new Vector(this.x - v.x, this.y - v.y)
   }
   rotatedBy(rotation: Rotation): Vector {
      let cos = this.x * rotation.x - this.y * rotation.y
      let sin = this.y * rotation.x + this.x * rotation.y
      return new Vector(cos, sin)
   }
   dot(v: Vector): number {
      return this.x * v.x + this.y * v.y
   }
   projectionOnto(v: Vector): Vector {
      let vdotV = v.dot(v)
      return vdotV === 0 ? new Vector(0, 0) : v.scaledBy(this.dot(v) / vdotV)
   }
   scalarProjectionOnto(v: Vector): number {
      let vLength = v.length()
      return vLength === 0 ? 0 : this.dot(v) / vLength
   }
   rejectionFrom(v: Vector): Vector {
      return this.sub(this.projectionOnto(v))
   }
   scalarRejectionFrom(v: Vector): number {
      let vLength = v.length()
      return vLength === 0
         ? this.length()
         : (this.y * v.x - this.x * v.y) / vLength
   }
   // Express the vector in terms of the coordinate system implied by the
   // given Axis. (`axis` is the x-direction, and `axis.orthogonal()` is y.)
   relativeTo(axis: Axis): Vector {
      let [cos, sin] = [axis.x, axis.y]
      let [x, y] = [this.x, this.y]
      return new Vector(cos * x + sin * y, -sin * x + cos * y)
   }
   undoRelativeTo(axis: Axis): Vector {
      let [cos, sin] = [axis.x, axis.y]
      let [x, y] = [this.x, this.y]
      return new Vector(cos * x - sin * y, sin * x + cos * y)
   }
}

export class Point extends Object2D {
   readonly x: number
   readonly y: number
   static readonly zero = new Point(0, 0)

   constructor(x: number, y: number) {
      super()
      this.x = x
      this.y = y
   }
   partClosestTo(point: Point): Point {
      return this
   }
   override sqDistanceFrom(p: Point): number {
      let dx = this.x - p.x
      let dy = this.y - p.y
      return dx * dx + dy * dy
   }
   displacementFrom(p: Point): Vector {
      return new Vector(this.x - p.x, this.y - p.y)
   }
   directionFrom(p: Point): Direction | undefined {
      return Direction.fromVector(this.displacementFrom(p))
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

// A Rotation is a _difference_ between two Directions.
export class Rotation {
   readonly x: number
   readonly y: number
   static readonly zero = this.fromAngle(0)

   protected constructor(x: number, y: number) {
      this.x = x
      this.y = y
   }
   static fromAngle(radians: number): Rotation {
      return new Rotation(Math.cos(radians), Math.sin(radians))
   }
   toAngle(): number {
      return Math.atan2(this.y, this.x)
   }
   scaledBy(factor: number): Rotation {
      return Rotation.fromAngle(factor * this.toAngle())
   }
   add(rotation: Rotation): Rotation {
      let cos = this.x * rotation.x - this.y * rotation.y
      let sin = this.y * rotation.x + this.x * rotation.y
      return new Rotation(cos, sin)
   }
   sub(rotation: Rotation): Rotation {
      let cos = this.x * rotation.x + this.y * rotation.y
      let sin = this.y * rotation.x - this.x * rotation.y
      return new Rotation(cos, sin)
   }
}

export class Direction extends Vector {
   protected constructor(x: number, y: number) {
      super(x, y)
   }
   protected asRotation(): Rotation {
      // subvert constructor privacy
      return new (Rotation as any)(this.x, this.y)
   }
   static fromVector(vec: Vector): Direction | undefined {
      let v = vec.normalized()
      if (v) return new Direction(v.x, v.y)
   }
   rotationFrom(dir: Direction): Rotation {
      return this.asRotation().sub(dir.asRotation())
   }
   rotatedBy(rotation: Rotation): Direction {
      let r = this.asRotation().add(rotation)
      return new Direction(r.x, r.y)
   }
}

function mod(x: number, y: number) {
   return ((x % y) + y) % y
}

// We encode an axis as a unit vector with an angle in [-90°, 90°).
export class Axis extends Vector {
   static readonly horizontal = new Axis(1, 0)
   static readonly vertical = new Axis(0, -1)
   protected constructor(x: number, y: number) {
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
   static fromDirection(dir: Direction): Axis {
      return Axis.fromVector(dir) as Axis
   }
   orthogonal(): Axis {
      return this.y >= 0 ? new Axis(this.y, -this.x) : new Axis(-this.y, this.x)
   }
   posDirection(): Direction {
      return Direction.fromVector(this) as Direction
   }
   negDirection(): Direction {
      return Direction.fromVector(this.scaledBy(-1)) as Direction
   }
   approxEquals(axis: Axis, errorRatio: number): boolean {
      let absoluteError = errorRatio // For axes, these are the same.
      return (
         axis.x - absoluteError <= this.x &&
         axis.x + absoluteError >= this.x &&
         axis.y - absoluteError <= this.y &&
         axis.y + absoluteError >= this.y
      )
   }
}

// A line of infinite length.
export class Line extends Object2D {
   readonly origin: Point
   readonly axis: Axis
   constructor(origin: Point, axis: Axis) {
      super()
      this.origin = origin
      this.axis = axis
   }
   partClosestTo(point: Point): Point {
      return this.origin.displacedBy(
         point.displacementFrom(this.origin).projectionOnto(this.axis)
      )
   }
   intersection(object: Line | Ray | Segment): Point | undefined {
      return genericIntersection(this, object)
   }
}

// A line that extends infinitely in (only) one direction.
export class Ray extends Object2D {
   readonly origin: Point
   readonly direction: Direction
   readonly axis: Axis
   constructor(origin: Point, dir: Direction) {
      super()
      this.origin = origin
      this.direction = dir
      this.axis = Axis.fromDirection(this.direction)
   }
   partClosestTo(point: Point): Point {
      let p = point.displacementFrom(this.origin).projectionOnto(this.direction)
      if (
         Math.sign(p.x) === Math.sign(this.direction.x) &&
         Math.sign(p.y) === Math.sign(this.direction.y)
      ) {
         return this.origin.displacedBy(p)
      } else return this.origin
   }
   intersection(object: Line | Ray | Segment): Point | undefined {
      return genericIntersection(this, object)
   }
   // Whether the given point projects onto the ray.
   shadowedBy(point: Point): boolean {
      return point.displacementFrom(this.origin).dot(this.direction) >= 0
   }
}

// A line segment.
export class Segment extends Object2D {
   static readonly zero = new Segment(Point.zero, Point.zero, Axis.horizontal)
   readonly start: Point
   readonly end: Point
   readonly axis: Axis
   constructor(start: Point, end: Point, axis: Axis) {
      super()
      this.start = start
      this.end = end
      this.axis = axis
   }
   partClosestTo(point: Point): Point {
      let d = this.end.displacementFrom(this.start)
      let p = point.displacementFrom(this.start).projectionOnto(this.axis)
      if (
         Math.sign(p.x) !== Math.sign(d.x) ||
         Math.sign(p.y) !== Math.sign(d.y)
      ) {
         return this.start
      } else if (p.sqLength() > d.sqLength()) {
         return this.end
      } else {
         return this.start.displacedBy(p)
      }
   }
   sqLength(): number {
      return this.end.sqDistanceFrom(this.start)
   }
   length(): number {
      return this.end.distanceFrom(this.start)
   }
   intersection(object: Line | Ray | Segment): Point | undefined {
      return genericIntersection(this, object)
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
}

// A representation of two Segments that cross one another.
export class Crossing extends Object2D {
   seg1: Segment
   seg2: Segment
   point: Point
   constructor(seg1: Segment, seg2: Segment, point: Point) {
      super()
      this.seg1 = seg1
      this.seg2 = seg2
      this.point = point
   }
   partClosestTo(point: Point): Point {
      return this.point
   }
}

// Computes the point of intersection of two line-like objects.
function genericIntersection(
   lineA: Line | Ray | Segment,
   lineB: Line | Ray | Segment
): Point | undefined {
   if (lineA.axis === lineB.axis) return undefined
   let p1, p2, p3, p4
   let [p1Inf, p2Inf, p3Inf, p4Inf] = [false, false, false, false]
   if (lineA instanceof Line) {
      ;[p1, p2] = [lineA.origin, lineA.origin.displacedBy(lineA.axis)]
      ;[p1Inf, p2Inf] = [true, true]
   } else if (lineA instanceof Ray) {
      ;[p1, p2] = [lineA.origin, lineA.origin.displacedBy(lineA.direction)]
      p2Inf = true
   } else {
      ;[p1, p2] = [lineA.start, lineA.end]
   }
   if (lineB instanceof Line) {
      ;[p3, p4] = [lineB.origin, lineB.origin.displacedBy(lineB.axis)]
      ;[p3Inf, p4Inf] = [true, true]
   } else if (lineB instanceof Ray) {
      ;[p3, p4] = [lineB.origin, lineB.origin.displacedBy(lineB.direction)]
      p4Inf = true
   } else {
      ;[p3, p4] = [lineB.start, lineB.end]
   }
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
         (p1Inf || t >= 0) &&
         (p2Inf || t <= denominator) &&
         (p3Inf || u >= 0) &&
         (p4Inf || u <= denominator)) ||
      (denominator < 0 &&
         (p1Inf || t <= 0) &&
         (p2Inf || t >= denominator) &&
         (p3Inf || u <= 0) &&
         (p4Inf || u >= denominator))
   ) {
      t /= denominator
      let x = p1.x - dx12 * t
      let y = p1.y - dy12 * t
      return new Point(x, y)
   } else return undefined
}

export class Range1D {
   readonly low: number
   readonly high: number
   // Return the unsigned Range between the given numbers.
   constructor(v1: number, v2: number) {
      this.low = Math.min(v1, v2)
      this.high = Math.max(v1, v2)
   }
}

export class Range2D {
   readonly x: Range1D
   readonly y: Range1D
   protected constructor(x: Range1D, y: Range1D) {
      this.x = x
      this.y = y
   }
   static fromCorners(p1: Point, p2: Point) {
      return new Range2D(new Range1D(p1.x, p2.x), new Range1D(p1.y, p2.y))
   }
   static fromXY(x: Range1D, y: Range1D) {
      return new Range2D(x, y)
   }
   contains(point: Point) {
      return (
         this.x.low <= point.x &&
         point.x <= this.x.high &&
         this.y.low <= point.y &&
         point.y <= this.y.high
      )
   }
}

export class Rectangle extends Object2D {
   protected position: Point
   protected rotation: Rotation
   protected readonly range: Range2D
   constructor(position: Point, rotation: Rotation, range: Range2D) {
      super()
      this.position = position
      this.rotation = rotation
      this.range = range
   }
   toRectCoordinates(point: Point): Point {
      return Point.zero.displacedBy(
         point
            .displacementFrom(this.position)
            .rotatedBy(this.rotation.scaledBy(-1))
      )
   }
   fromRectCoordinates(point: Point): Point {
      return this.position.displacedBy(
         point.displacementFrom(Point.zero).rotatedBy(this.rotation)
      )
   }
   partClosestTo(point: Point): Point {
      let p = this.toRectCoordinates(point)
      let { x, y } = this.range
      let partX = p.x < x.low ? x.low : p.x > x.high ? x.high : p.x
      let partY = p.y < y.low ? y.low : p.y > y.high ? y.high : p.y
      return this.fromRectCoordinates(new Point(partX, partY))
   }
   contains(point: Point): boolean {
      let p = this.toRectCoordinates(point)
      let { x, y } = this.range
      return x.low <= p.x && p.x <= x.high && y.low <= p.y && p.y <= y.high
   }
}

export type ClosenessResult<T> =
   | {
        object: T
        sqDistance: number
        closestPart: Point
     }
   | undefined

// Find the closest Object2D to the given Point.
export function closestTo<T extends Object2D>(
   point: Point,
   ...objectSets: Iterable<T>[]
): ClosenessResult<T> {
   let closest: ClosenessResult<T>
   for (let set of objectSets) {
      for (let object of set) {
         let closestPart = object.partClosestTo(point)
         let sqDistance = closestPart.sqDistanceFrom(point)
         if (!closest || sqDistance < closest.sqDistance) {
            closest = { object, sqDistance, closestPart }
         }
      }
   }
   return closest
}

// A variant of closestTo() exclusively for Segments.
// Distance is measured with respect to the given axis.
export function closestSegmentTo(
   point: Point,
   alongAxis: Axis,
   segments: Iterable<Segment>
): ClosenessResult<Segment> {
   let closest: ClosenessResult<Segment>
   for (let segment of segments) {
      if (segment.axis === alongAxis) continue
      let closestPart = segment.intersection(new Line(point, alongAxis))
      if (!closestPart) continue
      let sqDistance = closestPart.sqDistanceFrom(point)
      if (!closest || sqDistance < closest.sqDistance) {
         closest = { object: segment, sqDistance, closestPart }
      }
   }
   return closest
}
