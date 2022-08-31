import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import * as path from "path"

// https://vitejs.dev/config/
export default defineConfig({
   plugins: [svelte()], // to turn off hot reload, add {hot: false} to svelte()
   base: "",
   resolve: {
      alias: {
         "~": path.resolve(__dirname, "src"),
      },
   },
   build: {
      outDir: "dist-web",
   },
})
