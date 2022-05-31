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
export class Rotation extends VectorBase {
   static readonly zero = this.fromAngle(0)
   protected constructor(x: number, y: number) {
      super(x, y)
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
   axis(): Axis {
      return Axis.fromVector(this) as Axis
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
   orthogonal(): Axis {
      return this.y >= 0 ? new Axis(this.y, -this.x) : new Axis(-this.y, this.x)
   }
   posDirection(): Direction {
      return Direction.fromVector(this) as Direction
   }
   negDirection(): Direction {
      return Direction.fromVector(this.scaledBy(-1)) as Direction
   }
   approxEquals(a: this, errorRatio: number): boolean {
      return (
         super.approxEquals(a, errorRatio) ||
         super.approxEquals(a.scaledBy(-1) as this, errorRatio)
      )
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
   readonly direction: Direction
   constructor(origin: Point, dir: Direction) {
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

export class BoundingBox {
   x1: number
   x2: number
   y1: number
   y2: number
   rotation: Rotation
   protected constructor(
      x1: number,
      x2: number,
      y1: number,
      y2: number,
      rotation: Rotation
   ) {
      this.x1 = x1
      this.x2 = x2
      this.y1 = y1
      this.y2 = y2
      this.rotation = rotation
   }
   static fromXY(x1: number, x2: number, y1: number, y2: number) {
      return new BoundingBox(x1, x2, y1, y2, Rotation.zero)
   }
   displacedBy(displacement: Vector): BoundingBox {
      return new BoundingBox(
         this.x1 + displacement.x,
         this.x2 + displacement.x,
         this.y1 + displacement.y,
         this.y2 + displacement.y,
         this.rotation
      )
   }
   // Rotate the bounding box around its implicitly-defined origin.
   rotatedBy(rotation: Rotation): BoundingBox {
      return new BoundingBox(
         this.x1,
         this.x2,
         this.y1,
         this.y2,
         this.rotation.add(rotation)
      )
   }
   *corners(): Generator<Point> {
      let c = this.rotation.x
      let s = this.rotation.y
      yield new Point(c * this.x1 - s * this.y1, s * this.x1 + c * this.y1)
      yield new Point(c * this.x2 - s * this.y1, s * this.x2 + c * this.y1)
      yield new Point(c * this.x2 - s * this.y2, s * this.x2 + c * this.y2)
      yield new Point(c * this.x1 - s * this.y2, s * this.x1 + c * this.y2)
   }
}
