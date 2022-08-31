const { app, BrowserWindow } = require("electron")

const createWindow = () => {
   const window = new BrowserWindow({
      width: 800,
      height: 600,
      sandbox: false, // TODO: Is this correct?
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
