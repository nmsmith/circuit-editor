// A very handy extension of "Map".
// When a DefaultMap is constructed, the user gives it a default value,
// and if get0() would fail, it returns that default value instead.
// Thus, get0() always succeeds.
export class DefaultMap<K, V> extends Map<K, V> {
   readonly defaultValue: () => V
   constructor(defaultValue: () => V, entries?: Iterable<[K, V]>) {
      super(entries)
      this.defaultValue = defaultValue
   }
   // Special version of Map.get() that returns the default value
   // if the entry doesn't exist.
   get0(key: K): V {
      if (!this.has(key)) {
         this.set(key, this.defaultValue())
      }
      return super.get(key) as V
   }
   // A useful new method
   update(key: K, f: (existingValue: V) => V): void {
      this.set(key, f(this.get0(key)))
   }
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
