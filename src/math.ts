export class Vec {
   x: number
   y: number
   constructor(x: number, y: number) {
      this.x = x
      this.y = y
   }
   length(): number {
      return Math.sqrt(this.x * this.x + this.y * this.y)
   }
   lengthSq(): number {
      return this.x * this.x + this.y * this.y
   }
   distance(v: Vec): number {
      return this.sub(v).length()
   }
   distanceSq(v: Vec): number {
      return this.sub(v).lengthSq()
   }
   scale(s: number): Vec {
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
   copy(v: Vec) {
      this.x = v.x
      this.y = v.y
   }
   clone(): Vec {
      return new Vec(this.x, this.y)
   }
}

export class Line {
   start: Vec
   end: Vec
   constructor(start: Vec, end: Vec) {
      this.start = start
      this.end = end
   }

   // Returns the endpoints of the line, plus the specified number of
   // interior points (equally spaced).
   *points(interiorPoints: number) {
      yield this.start
      if (interiorPoints > 0) {
         let d = this.end.sub(this.start).scale(1 / (interiorPoints + 1))
         for (
            let i = 0, p = this.start.add(d);
            i < interiorPoints;
            ++i, p = p.add(d)
         ) {
            yield p
         }
      }
      yield this.end
   }
}
