export {}
import nodePath from "node:path"
import type { EditHistory } from "./shared/circuit"

declare global {
   const path: typeof nodePath // magic 😉
   const fileSystem: {
      openDirectory: () => Promise<string | null>
      getFileNames: (directory: string) => Promise<string[] | null>
      saveEditHistory: (
         filePath: string,
         history: EditHistory
      ) => Promise<
         { outcome: "success" } | { outcome: "failure"; error: Error }
      >
      loadEditHistory: (
         filePath: string
      ) => Promise<
         | { outcome: "success"; history: EditHistory }
         | { outcome: "failure"; error: Error }
      >
   }
}
