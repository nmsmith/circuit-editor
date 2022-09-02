export {}
import nodePath from "node:path"

declare global {
   const path: typeof nodePath // magic 😉
   const fileSystem: {
      openDirectory: () => Promise<string | null>
      getFileNames: (directory: string) => Promise<string[] | null>
   }
}
