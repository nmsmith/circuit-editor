// This file is nothing more than a hack to expose types for use in other files
// where TypeScript has failed to infer them.

import electron from "electron"
import path from "node:path"
import fs from "node:fs/promises"
import zlib from "node:zlib"
import util from "node:util"

declare global {
   type Electron = typeof electron
   type Path = typeof path
   type FS = typeof fs
   type Zlib = typeof zlib
   type Util = typeof util
}
