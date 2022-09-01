const { contextBridge, ipcRenderer } = require("electron")

// NOTE: All of the global variables exposed in this file should ALSO be
// given a type in "preload.d.ts".

contextBridge.exposeInMainWorld("fileSystem", {
   openDirectory: () => ipcRenderer.invoke("openDirectory"),
   getFileNames: (directory) => ipcRenderer.invoke("getFileNames", directory),
})
