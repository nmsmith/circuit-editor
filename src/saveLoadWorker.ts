import * as Comlink from "comlink"
import { CircuitJSON, emptyCircuitJSON } from "./shared/circuit"

const fs: FS = require("node:fs/promises")
const zlib: Zlib = require("node:zlib")
const util: Util = require("node:util")
const gzip = util.promisify(zlib.gzip)
const gunzip = util.promisify(zlib.gunzip)

export type CircuitHistory<StateType> = {
   readonly stackSizeLimit: 200
   stack: { state: StateType; description: string }[]
   index: number // Index of the current state.
   timestamp: number // Counts the number of updates to the history.
   timestampOfLastSave: number
}
// Whenever a change is made to this data structure, a corresponding
// change must be made to the "twin" data structure within the main thread.
let history: CircuitHistory<string> = emptyHistory()

function emptyHistory(): CircuitHistory<string> {
   let state = JSON.stringify(emptyCircuitJSON)
   return {
      stackSizeLimit: 200,
      stack: [{ state, description: "blank canvas" }],
      index: 0,
      timestamp: 0,
      timestampOfLastSave: 0,
   }
}
const workerInterface = {
   commitState(state: CircuitJSON, description: string) {
      history.stack.length = history.index + 1 // Forget undone states.
      history.stack.push({ state: JSON.stringify(state), description })
      if (history.stack.length > history.stackSizeLimit) {
         history.stack = history.stack.slice(1) // drop the oldest state
      } else {
         ++history.index
      }
      history.timestamp += 1
   },
   executeUndo() {
      if (history.index > 0) --history.index
      history.timestamp += 1
   },
   executeRedo() {
      let lastIndex = history.stack.length - 1
      if (history.index < lastIndex) ++history.index
      history.timestamp += 1
   },
   executeTimeTravel(historyIndex: number) {
      history.index = historyIndex
      history.timestamp += 1
   },
   clearHistory() {
      history = emptyHistory()
   },
   async saveHistory(
      filePath: string
   ): Promise<
      | { outcome: "success"; timestampOfSave: number }
      | { outcome: "failure"; error: Error }
   > {
      let oldSaveTimestamp = history.timestampOfLastSave
      try {
         // Beware: The user may continue to commit new states (thus changing
         // "history") between calls to "await".
         history.timestampOfLastSave = history.timestamp
         await fs.writeFile(filePath, await gzip(JSON.stringify(history)))
         return {
            outcome: "success",
            timestampOfSave: history.timestampOfLastSave,
         }
      } catch (e) {
         history.timestampOfLastSave = oldSaveTimestamp // revert the timestamp
         return { outcome: "failure", error: e as Error }
      }
   },
   async loadHistory(
      filePath: string
   ): Promise<
      | { outcome: "success"; history: CircuitHistory<CircuitJSON> }
      | { outcome: "failure"; error: Error }
   > {
      try {
         history = JSON.parse(
            (await gunzip(await fs.readFile(filePath))) as unknown as string
         )
         return {
            outcome: "success",
            history: {
               ...history,
               stack: history.stack.map((item) => {
                  return { ...item, state: JSON.parse(item.state) }
               }),
            },
         }
      } catch (e) {
         return { outcome: "failure", error: e as Error }
      }
   },
}

Comlink.expose(workerInterface)
export type WorkerInterface = typeof workerInterface
