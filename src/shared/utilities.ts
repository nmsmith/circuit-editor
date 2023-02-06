// A very handy extension of "Map".
// When a DefaultMap is constructed, the user gives it a default value,
// and if read() would fail, it returns that default value instead.
// Thus, read() always succeeds.
export class DefaultMap<K, V> extends Map<K, V> {
   readonly defaultValue: () => V
   constructor(defaultValue: () => V, entries?: Iterable<[K, V]>) {
      super(entries)
      this.defaultValue = defaultValue
   }
   // A variant of Map.get() which is intended to be used for
   // READ-ONLY access. If the entry doesn't exist, it returns
   // the default value, but it DOESN'T initialize the entry.
   // (Therefore, mutating the return value doesn't change the Map.)
   read(key: K): V {
      if (this.has(key)) {
         return super.get(key) as V
      } else {
         return this.defaultValue()
      }
   }
   // A variant of Map.get() that initializes the entry with the
   // default value if it didn't already exist.
   getOrCreate(key: K): V {
      if (this.has(key)) {
         return super.get(key) as V
      } else {
         let v = this.defaultValue()
         this.set(key, v)
         return v
      }
   }
   update(key: K, f: (existingValue: V) => V): void {
      this.set(key, f(this.getOrCreate(key)))
   }
   clone(): DefaultMap<K, V> {
      return new DefaultMap(this.defaultValue, this)
   }
}

export class DefaultWeakMap<K extends Object, V> extends WeakMap<K, V> {
   readonly defaultValue: () => V
   constructor(defaultValue: () => V, entries?: readonly [K, V][]) {
      super(entries)
      this.defaultValue = defaultValue
   }
   read(key: K): V {
      if (this.has(key)) {
         return super.get(key) as V
      } else {
         return this.defaultValue()
      }
   }
   getOrCreate(key: K): V {
      if (this.has(key)) {
         return super.get(key) as V
      } else {
         let v = this.defaultValue()
         this.set(key, v)
         return v
      }
   }
   update(key: K, f: (existingValue: V) => V): void {
      this.set(key, f(this.getOrCreate(key)))
   }
}

export function sameSet(s1: Set<any>, s2: Set<any>): boolean {
   if (s1.size !== s2.size) return false
   for (let e of s1) if (!s2.has(e)) return false
   return true
}

export class ToggleSet<K> extends Set<K> {
   toggle(key: K) {
      if (this.has(key)) {
         this.delete(key)
      } else {
         this.add(key)
      }
   }
   // toggleGroup(keys: K[]) {
   //    let hasAll = true
   //    for (let key of keys) {
   //       hasAll &&= this.has(key)
   //    }
   //    if (hasAll) {
   //       for (let key of keys) this.delete(key)
   //    } else {
   //       for (let key of keys) this.add(key)
   //    }
   // }
}
