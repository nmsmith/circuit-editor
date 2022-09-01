const { app, BrowserWindow, ipcMain, dialog } = require("electron")
const { readdir } = require("node:fs/promises")

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
         // nodeIntegrationInWorker: true,
         // sandbox: false,
         // contextIsolation: false,
         preload: `${__dirname}/preload.cjs`,
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
   if (process.env.NODE_ENV === "development") {
      // Load the Vite dev server page.
      window.loadURL("http://localhost:5173/")
      window.webContents.openDevTools({ mode: "bottom" })
   } else {
      // Load the production build.
      window.loadFile(`${__dirname}/../dist-web/index.html`)
   }
}

app.whenReady().then(() => {
   createWindow()
})

app.on("window-all-closed", () => {
   app.quit()
})
