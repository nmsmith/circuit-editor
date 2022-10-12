const { contextBridge, ipcRenderer } = require("electron")
const path = require("node:path")

// NOTE: All of the global variables exposed in this file should ALSO be
// given a type in "preload.d.ts".

contextBridge.exposeInMainWorld("path", {
   ...path,
})

contextBridge.exposeInMainWorld("fileSystem", {
   openDirectory: () => ipcRenderer.invoke("openDirectory"),
   getFileNames: (directory) => ipcRenderer.invoke("getFileNames", directory),
   saveEditHistory: (filePath, history) =>
      ipcRenderer.invoke("saveEditHistory", filePath, history),
   loadEditHistory: (filePath) =>
      ipcRenderer.invoke("loadEditHistory", filePath),
})
