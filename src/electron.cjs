const { app, BrowserWindow, ipcMain, dialog } = require("electron")
const { readdir, readFile, writeFile } = require("node:fs/promises")
const path = require("node:path")

let webSecurity
if (process.env.NODE_ENV === "development") {
   // Necessary to allow SVGs to be loaded from the local filesystem whilst
   // running the dev server at localhost.
   webSecurity = false
   app.commandLine.appendSwitch("disable-site-isolation-trials")
   process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true"
} else {
   webSecurity = true
}

const createWindow = () => {
   const window = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
         // nodeIntegration: true,
         // contextIsolation: false,
         sandbox: false, // Allow the preload script to have access to Node.
         preload: path.join(__dirname, "preload.cjs"),
         webSecurity,
      },
   })
   ipcMain.handle("openDirectory", async () => {
      let { filePaths } = await dialog.showOpenDialog(window, {
         properties: ["openDirectory"],
      })
      return filePaths.length > 0 ? filePaths[0] : null
   })
   ipcMain.handle("getFileNames", async (event, directory) => {
      try {
         return await readdir(directory)
      } catch {
         return null
      }
   })
   ipcMain.handle("saveEditHistory", async (event, filePath, history) => {
      try {
         await writeFile(filePath, JSON.stringify(history))
         return { outcome: "success" }
      } catch (error) {
         return { outcome: "failure", error }
      }
   })
   ipcMain.handle("loadEditHistory", async (event, filePath) => {
      try {
         return {
            outcome: "success",
            history: JSON.parse(await readFile(filePath, "utf8")),
         }
      } catch (error) {
         return { outcome: "failure", error }
      }
   })
   if (process.env.NODE_ENV === "development") {
      // Load the Vite dev server page.
      window.loadURL("http://localhost:5173/")
      window.webContents.openDevTools({ mode: "bottom" })
   } else {
      // Load the production build.
      window.loadFile(path.join(__dirname, "..", "dist-web", "index.html"))
   }
}

app.whenReady().then(() => {
   createWindow()
})

app.on("window-all-closed", () => {
   app.quit()
})
