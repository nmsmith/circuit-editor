import { DefaultMap } from "./utilities"

const tau = 2 * Math.PI
// This global variable keeps track of the Axes used by the program. The goal
// is to simulate value equality, which JavaScript doesn't have.
const axes = new DefaultMap<Axis, number>(() => 0)
// Users need to declare which Axis objects they want to be remembered, so that
// the Axis static methods can return these existing objects rather than create
// new ones. (i.e. this is manual memory management.)
export function rememberAxis(axis: Axis) {
   axes.update(axis, (c) => c + 1)
}
export function forgetAxis(axis: Axis) {
   let count = axes.read(axis)
   count > 1 ? axes.set(axis, count - 1) : axes.delete(axis)
}
// The error ratio (∈ [0, 1]) at which two axes should be considered parallel.
const axisErrorTolerance = 0.00001
// Find an existing Axis object that has approximately the same value.
function findAxis(subject: Axis): Axis
function findAxis(subject: Axis | undefined): Axis | undefined
function findAxis(subject: Axis | undefined): Axis | undefined {
   if (!subject) return undefined
   for (let axis of axes.keys()) {
      if (
         subject.approxEquals(axis, axisErrorTolerance) ||
         subject.approxEquals(axis.scaledBy(-1), axisErrorTolerance)
      )
         return axis
   }
   return subject
}

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
   direction(): Direction | undefined {
      return Direction.fromVector(this)
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
   approxEquals(other: any, absoluteError: number): boolean {
      if (!(other instanceof Vector)) return false
      return (
         other.x - absoluteError <= this.x &&
         other.x + absoluteError >= this.x &&
         other.y - absoluteError <= this.y &&
         other.y + absoluteError >= this.y
      )
   }
   // Express the Vector as a linear combination of the given basis vectors.
   inTermsOfBasis(basis: [Vector, Vector]): [Vector, Vector] {
      if (basis[0].approxEquals(basis[1], 0.001))
         console.error(
            `Cannot construct a basis from two identical vectors: (${basis[0].x}, ${basis[0].y}) and (${basis[0].x}, ${basis[0].y}).`
         )
      return [
         basis[0].scaledBy(
            (basis[1].x * this.y - basis[1].y * this.x) /
               (basis[1].x * basis[0].y - basis[1].y * basis[0].x)
         ),
         basis[1].scaledBy(
            (basis[0].x * this.y - basis[0].y * this.x) /
               (basis[0].x * basis[1].y - basis[0].y * basis[1].x)
         ),
      ]
   }
   // Express the Vector in terms of the coordinate system implied by the
   // given Vector, treated as an X-axis.
   relativeTo(axis: Vector): Vector {
      let [cos, sin] = [axis.x, axis.y]
      let [x, y] = [this.x, this.y]
      return new Vector(cos * x + sin * y, -sin * x + cos * y)
   }
   undoRelativeTo(axis: Vector): Vector {
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
   center(): Point {
      return this
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
   axisFrom(p: Point): Axis | undefined {
      return Axis.fromVector(this.displacementFrom(p))
   }
   displacedBy(v: Vector): Point {
      return new Point(this.x + v.x, this.y + v.y)
   }
   interpolatedToward(point: Point, fraction: number): Point {
      return this.displacedBy(point.displacementFrom(this).scaledBy(fraction))
   }
   rotatedAround(p: Point, r: Rotation): Point {
      return p.displacedBy(this.displacementFrom(p).rotatedBy(r))
   }
   clone(): Point {
      return new Point(this.x, this.y)
   }
   // A copy of Vector.relativeTo().
   relativeTo(axis: Vector): Point {
      let [cos, sin] = [axis.x, axis.y]
      let [x, y] = [this.x, this.y]
      return new Point(cos * x + sin * y, -sin * x + cos * y)
   }
   // A copy of Vector.undoRelativeTo().
   undoRelativeTo(axis: Vector): Point {
      let [cos, sin] = [axis.x, axis.y]
      let [x, y] = [this.x, this.y]
      return new Point(cos * x - sin * y, sin * x + cos * y)
   }
   // Arithmetic mean.
   static mean(points: Point[]): Point {
      if (points.length === 0) return Point.zero
      let [x, y] = [0, 0]
      for (let p of points) {
         x += p.x
         y += p.y
      }
      return new Point(x / points.length, y / points.length)
   }
   // Median of the x-coordinates and y-coordinates.
   static median(points: Point[]): Point {
      if (points.length === 0) return Point.zero
      let xs = points.map((p) => p.x).sort((a, b) => a - b)
      let ys = points.map((p) => p.y).sort((a, b) => a - b)
      let i = Math.floor(points.length / 2)
      return new Point(xs[i], ys[i])
   }
}

// A Rotation is a _difference_ between two Directions.
export class Rotation {
   readonly x: number
   readonly y: number
   static readonly zero = this.fromRadians(0)
   static readonly halfTurn = this.fromRadians(0.5 * tau)

   protected constructor(x: number, y: number) {
      this.x = x
      this.y = y
   }
   static fromRadians(radians: number): Rotation {
      return new Rotation(Math.cos(radians), Math.sin(radians))
   }
   static fromDegrees(degrees: number): Rotation {
      return Rotation.fromRadians((degrees / 360) * tau)
   }
   toRadians(): number {
      return Math.atan2(this.y, this.x)
   }
   toDegrees(): number {
      return (this.toRadians() / tau) * 360
   }
   scaledBy(factor: number): Rotation {
      return Rotation.fromRadians(factor * this.toRadians())
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
   static readonly positiveX = new Direction(1, 0)
   static readonly negativeX = new Direction(-1, 0)
   static readonly positiveY = new Direction(0, 1)
   static readonly negativeY = new Direction(0, -1)
   protected constructor(x: number, y: number) {
      super(x, y)
   }
   static fromVector(vec: Vector): Direction | undefined {
      let length = vec.length()
      if (length > 0) return new Direction(vec.x / length, vec.y / length)
   }
   protected rotationFromPositiveX(): Rotation {
      // subvert constructor privacy
      return new (Rotation as any)(this.x, this.y)
   }
   rotationFrom(dir: Direction): Rotation {
      return this.rotationFromPositiveX().sub(dir.rotationFromPositiveX())
   }
   rotatedBy(rotation: Rotation): Direction {
      let r = this.rotationFromPositiveX().add(rotation)
      return new Direction(r.x, r.y)
   }
   reversed(): Direction {
      return new Direction(-this.x, -this.y)
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
   static fromRadians(radians: number): Axis {
      // Ensure the angle is in [-90°, 90°).
      const quarterTurn = Math.PI / 2
      radians = mod(radians + quarterTurn, Math.PI) - quarterTurn
      return findAxis(new Axis(Math.cos(radians), Math.sin(radians)))
   }
   static fromVector(vec: Vector): Axis | undefined {
      if (vec.x === 0 && vec.y === 0) {
         return undefined
      } else if (vec.x > 0 || (vec.x === 0 && vec.y < 0)) {
         let v = vec.scaledBy(1 / vec.length())
         return findAxis(new Axis(v.x, v.y))
      } else {
         let v = vec.scaledBy(-1 / vec.length())
         return findAxis(new Axis(v.x, v.y))
      }
   }
   static fromDirection(dir: Direction): Axis {
      return Axis.fromVector(dir) as Axis
   }
   orthogonal(): Axis {
      return findAxis(
         this.y >= 0 ? new Axis(this.y, -this.x) : new Axis(-this.y, this.x)
      )
   }
   posDirection(): Direction {
      return Direction.fromVector(this) as Direction
   }
   negDirection(): Direction {
      return Direction.fromVector(this.scaledBy(-1)) as Direction
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
   intersection(object: Line | LineSegment | Ray): Point | undefined {
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
   intersection(object: Line | LineSegment | Ray): Point | undefined {
      return genericIntersection(this, object)
   }
   // Whether the given point projects onto the ray.
   shadowedBy(point: Point): boolean {
      return point.displacementFrom(this.origin).dot(this.direction) >= 0
   }
}

// The endpoints of a line segment are parameterized to be a subclass
// of Point, so that users can use their own "Point-like" objects.
export class LineSegment<P extends Point = Point> extends Object2D {
   readonly start: P
   readonly end: P
   readonly axis: Axis
   constructor(start: P, end: P, axis: Axis) {
      super()
      this.start = start
      this.end = end
      this.axis = axis
   }
   center(): Point {
      return this.start.interpolatedToward(this.end, 0.5)
   }
   partClosestTo(point: Point): Point {
      let d = this.end.displacementFrom(this.start)
      let p = point.displacementFrom(this.start).projectionOnto(d)
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
   connectsTo(segment: LineSegment): boolean {
      return (
         this.start === segment.start ||
         this.start === segment.end ||
         this.end === segment.start ||
         this.end === segment.end
      )
   }
   intersection(object: Line | LineSegment | Ray): Point | undefined {
      return genericIntersection(this, object)
   }
   // Whether the given point projects onto the line segment.
   shadowedBy(point: Point): boolean {
      let dot = point
         .displacementFrom(this.start)
         .dot(this.end.displacementFrom(this.start))
      return dot >= 0 && dot <= this.sqLength()
   }
}

// A representation of two line segments that cross one another.
export class LineSegmentCrossing<S extends LineSegment> extends Object2D {
   seg1: S
   seg2: S
   point: Point
   constructor(seg1: S, seg2: S, point: Point) {
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
   lineA: Line | LineSegment | Ray,
   lineB: Line | LineSegment | Ray
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
   constructor(values: number[], pad: number = 0) {
      this.low = Math.min(...values) - pad
      this.high = Math.max(...values) + pad
   }
   intersects(range: Range1D): boolean {
      return this.low < range.high && this.high > range.low
   }
   displacementFrom(range: Range1D): number {
      if (this.intersects(range)) return 0
      else if (this.high <= range.low) {
         return this.high - range.low
      } else {
         return this.low - range.high
      }
   }
   displacementFromContact(range: Range1D): number {
      let d1 = this.high - range.low
      let d2 = this.low - range.high
      return Math.abs(d1) <= Math.abs(d2) ? d1 : d2
   }
   center(): number {
      return (this.low + this.high) / 2
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
      return new Range2D(new Range1D([p1.x, p2.x]), new Range1D([p1.y, p2.y]))
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
   intersects(object: Range2D | Point | LineSegment | Rectangle) {
      if (object instanceof Range2D) {
         return this.x.intersects(object.x) && this.y.intersects(object.y)
      } else if (object instanceof Point) {
         return this.contains(object)
      } else if (object instanceof LineSegment) {
         return (
            this.contains(object.start) ||
            this.contains(object.end) ||
            new Rectangle(Point.zero, Rotation.zero, this)
               .sides()
               .some((side) => object.intersection(side))
         )
      } else {
         let mySides = new Rectangle(Point.zero, Rotation.zero, this).sides()
         return (
            object.corners().some((corner) => this.contains(corner)) ||
            this.corners().some((corner) => object.contains(corner)) ||
            object
               .sides()
               .some((side) => mySides.some((s) => s.intersection(side)))
         )
      }
   }
   width(): number {
      return this.x.high - this.x.low
   }
   height(): number {
      return this.y.high - this.y.low
   }
   corners(): Point[] {
      return [
         new Point(this.x.low, this.y.low),
         new Point(this.x.high, this.y.low),
         new Point(this.x.high, this.y.high),
         new Point(this.x.low, this.y.high),
      ]
   }
   center(): Point {
      return new Point(this.x.center(), this.y.center())
   }
}

export class Rectangle extends Object2D {
   readonly position: Point
   readonly direction: Direction
   readonly range: Range2D
   constructor(position: Point, rotation: Rotation, range: Range2D) {
      super()
      this.position = position
      this.direction = Rectangle.defaultDirection().rotatedBy(rotation)
      this.range = range
   }
   static defaultDirection(): Direction {
      return Direction.positiveX
   }
   protected rotation(): Rotation {
      return this.direction.rotationFrom(Rectangle.defaultDirection())
   }
   toRectCoordinates(point: Point): Point {
      return Point.zero.displacedBy(
         point
            .displacementFrom(this.position)
            .rotatedBy(this.rotation().scaledBy(-1))
      )
   }
   fromRectCoordinates(point: Point): Point {
      return this.position.displacedBy(
         point.displacementFrom(Point.zero).rotatedBy(this.rotation())
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
   center(): Point {
      return this.fromRectCoordinates(this.range.center())
   }
   corners(): Point[] {
      return this.range.corners().map((p) => this.fromRectCoordinates(p))
   }
   sides(): LineSegment[] {
      let [p1, p2, p3, p4] = this.corners()
      return [
         new LineSegment(p1, p2, p1.axisFrom(p2) || Axis.horizontal),
         new LineSegment(p2, p3, p2.axisFrom(p3) || Axis.vertical),
         new LineSegment(p3, p4, p3.axisFrom(p4) || Axis.horizontal),
         new LineSegment(p4, p1, p4.axisFrom(p1) || Axis.vertical),
      ]
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
         if (!closest || sqDistance <= closest.sqDistance) {
            closest = { object, sqDistance, closestPart }
         }
      }
   }
   return closest
}

// A variant of closestTo() exclusively for line segments.
// Distance is measured with respect to the given axis.
export function closestSegmentTo<S extends LineSegment>(
   point: Point,
   alongAxis: Axis,
   segments: Iterable<S>
): ClosenessResult<S> {
   let closest: ClosenessResult<S>
   for (let segment of segments) {
      if (segment.axis === alongAxis) continue
      let closestPart = segment.intersection(new Line(point, alongAxis))
      if (!closestPart) continue
      let sqDistance = closestPart.sqDistanceFrom(point)
      if (!closest || sqDistance <= closest.sqDistance) {
         closest = { object: segment, sqDistance, closestPart }
      }
   }
   return closest
}
