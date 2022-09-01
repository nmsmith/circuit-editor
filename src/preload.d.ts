export {}

declare global {
   const fileSystem: {
      openDirectory: () => Promise<string | null>
      getFileNames: (directory: string) => Promise<string[] | null>
   }
}
