import * as Comlink from "comlink"

const path: Path = require("node:path")
const fs: FS = require("node:fs/promises")
const zlib: Zlib = require("node:zlib")
const util: Util = require("node:util")
const gzip = util.promisify(zlib.gzip)
const gunzip = util.promisify(zlib.gunzip)

const autosaveFrequency = 2000 // milliseconds
const autosaveFileName = "autosave.json.gz"

let project: null | { folder: string; autosaveFilePath: string } = null
// Whenever a change is made to this data structure, a corresponding change
// must be made to the "twin" data structure within the main thread.
let history: {
   readonly stackSizeLimit: number
   stack: { state: string; description: string }[] // "state" is a string here
   index: number
   timestamp: number
   timestampOfLastSave: number
} = {
   stackSizeLimit: 200,
   stack: [],
   index: -1,
   timestamp: 0,
   timestampOfLastSave: 0,
}
Comlink.expose({
   blah() {
      console.log("BLAH!")
   },
   commitState(state: string, description: string) {
      history.stack.length = history.index + 1 // Forget undone states.
      history.stack.push({ state, description })
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
   async loadProjectHistory(projectFolder: string) {
      project = {
         folder: projectFolder,
         autosaveFilePath: path.join(projectFolder, autosaveFileName),
      }
      try {
         history = JSON.parse(
            (await gunzip(
               await fs.readFile(project.autosaveFilePath)
            )) as unknown as string
         )
         console.log("Successfully loaded autosave.")
         console.log(history)
      } catch (e) {
         let error = e as Error
         console.error(`Failed to load autosave. Reason:\n${error.message}`)
      }
   },
})

setInterval(autosave, autosaveFrequency)
// A hack to clear old intervals during hot reloading:
// for (let i = 0; i < intervalI; ++i) clearInterval(i)

async function autosave() {
   if (!project) return
   if (history.timestampOfLastSave === history.timestamp) return
   try {
      await fs.writeFile(
         project.autosaveFilePath,
         await gzip(JSON.stringify(history))
      )
      console.log("Autosaved.")
      history.timestampOfLastSave === history.timestamp
   } catch (e) {
      let error = e as Error
      console.error(`Autosave failed. Reason:\n${error.message}`)
   }
}
