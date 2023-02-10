<script lang="ts">
   import { onMount } from "svelte"
   import {
      Vertex,
      Edge,
      Junction,
      Port,
      Segment,
      Crossing,
      SymbolKind,
      SymbolInstance,
      LineType,
      Interactable,
      amassed,
      CircuitJSON,
      saveToJSON,
      loadFromJSON,
      emptyCircuitJSON,
      tetherLineType,
      SpecialAttachPoint,
      LineTypeConfig,
      VertexGlyphKind,
      CrossingGlyphKind,
      cut,
      copy,
      paste,
      duplicate,
      GlyphOrientation,
      Property,
      PropertyString,
      Tag,
      parseProperty,
      emptyTag,
      emptyPropertyString,
   } from "~/shared/circuit"
   import {
      rememberAxis,
      Object2D,
      Vector,
      Point,
      Rotation,
      Direction,
      Axis,
      Line,
      Range1D,
      Range2D,
      ClosenessResult,
      closestTo,
      closestSegmentTo,
   } from "~/shared/geometry"
   import * as Geometry from "~/shared/geometry"
   import { DefaultMap, sameSet } from "~/shared/utilities"
   import CircuitLine from "~/components/CircuitLine.svelte"
   import RectSelectBox from "~/components/RectSelectBox.svelte"
   import Button from "~/components/ToolButton.svelte"
   import Heap from "heap"
   import * as Comlink from "comlink"
   import type { WorkerInterface, CircuitHistory } from "~/saveLoadWorker"
   import GlyphSelectionBox from "./GlyphSelectionBox.svelte"
   import FakeRadioButton from "./FakeRadioButton.svelte"
   import TextBox from "./TextBox.svelte"

   // The following imports only succeed for the Electron version of this app.
   let usingElectron: boolean
   let path: Path
   let fs: FS
   let electron: Electron
   try {
      path = require("node:path")
      fs = require("node:fs/promises")
      electron = require("electron")
      usingElectron = true
   } catch (e) {
      usingElectron = false
   }
   function openDirectory(): Promise<string | null> {
      return electron.ipcRenderer.invoke("openDirectory")
   }

   // ------------------------------ Constants --------------------------------
   const autosaveFrequency = seconds(60)
   const autosaveFileName = "autosave.json.gz"
   const symbolFolderName = "symbols"
   const vertexGlyphFolderName = "vertex glyphs"
   const crossingGlyphFolderName = "crossing glyphs"
   const builtinGlyphFolderName = "built-in glyphs"
   const lineTypeFolderName = "lines"
   const symbolsForBrowserTesting = [
      "limit switch.svg",
      "prox sensor.svg",
      "pump.svg",
      "valve.svg",
      "relief.svg",
      "accumulator.svg",
   ]
   const vertexGlyphsForBrowserTesting = ["node.svg", "port.svg", "plug.svg"]
   const crossingGlyphsForBrowserTesting = ["hopover.svg"]
   const vertexMarkerFileName = "vertex marker.svg"
   const crossingMarkerFileName = "crossing marker.svg"
   const attachMarkerFileName = "attach marker.svg"
   const lineTypesForBrowserTesting = [
      "hydraulic.json",
      "pilot.json",
      "drain.json",
      "manifold.json",
      "reservoir.json",
   ]
   const lineTypeConfigFile = "config.json"
   let canvas: SVGElement | undefined // the root element of this component
   $: {
      if (canvas) {
         canvasWidth = canvas.getBoundingClientRect().width
         canvasHeight = canvas.getBoundingClientRect().height
      }
   }
   const row1Tools = ["qButton", "warp", "erase", "rButton"] as const
   const row2Tools = ["amass", "slide", "draw", "freeze"] as const
   const tools = [...row1Tools, ...row2Tools] as const
   type Tool = typeof tools[number]
   // Input constants
   const panSpeed = 1.5 // when panning with trackpad
   const pinchZoomSpeed = 0.02
   const wheelZoomSpeed = 0.14
   const minZoom = 0.1
   const maxZoom = 20
   const maxDoubleTapInterval = seconds(0.4) // per state machine transition
   const maxDoubleTapMove = 4 // in pixels
   // Math constants
   const tau = 2 * Math.PI
   const zeroVector = new Vector(0, 0)
   const infinityVector = new Vector(Infinity, Infinity)
   const err = 0.01 // constant to accommodate for floating-point error
   const sqErr = err ** 2
   // Circuit-sizing constants (zoom-independent)
   const sqMinSegmentLength = 10 ** 2
   const standardGap = 30 // standard spacing between circuit elements
   const halfGap = 15
   const slidePad = halfGap / 2 // dist at which close-passing elements collide
   const sqSegmentCrossingBuffer = 7.5 ** 2 // grace dist to ignore crossing
   const sqSegmentIntersectBuffer = 4 ** 2 // grace dist to ignore intersect
   // Zoom-dependent constants
   const sqShortDragDelay = 8 ** 2
   const sqLongDragDelay = 16 ** 2
   const easeRadius = 30 // dist btw mouse & snap point at which easing begins
   const snapRadius = 12 // dist btw mouse & snap point at which snapping occurs
   const snapJump = 5 // the distance things move at the moment they snap
   const sqEaseRadius = easeRadius ** 2
   const sqSnapRadius = snapRadius ** 2
   const sqInteractRadius = sqSnapRadius
   // The major axes that drawing occurs along.
   const primaryAxes = [Axis.horizontal, Axis.vertical]
   const snapAxes = [
      Axis.horizontal,
      Axis.vertical,
      Axis.fromRadians(0.125 * tau), // 45 degrees
      Axis.fromRadians(0.375 * tau), // 135 degrees
   ]
   snapAxes.forEach(rememberAxis)

   // ---------------------- Supplementary definitions ------------------------
   function asAny(x: any): any {
      return x
   }
   type Grabbable = Junction | Segment | SymbolInstance // Grabbed for moving.
   type Movable = Junction | SymbolInstance // Things that actually move.
   type Pushable = Junction | Segment | SymbolInstance // Recipients of pushes.
   type Attachable = Junction | Port | Segment | SpecialAttachPoint // Things a segment can attach to.
   type HasProperties = Vertex | Segment | SymbolInstance
   function isMovable(thing: any): thing is Movable {
      return thing instanceof Junction || thing instanceof SymbolInstance
   }
   function movableAt(vertex: Vertex): Movable {
      return vertex instanceof Junction ? vertex : vertex.symbol
   }
   function isVertex(thing: any): thing is Vertex {
      return thing instanceof Junction || thing instanceof Port
   }
   function* allVertices(): Generator<Vertex> {
      for (let v of Junction.s) yield v
      for (let v of Port.s) yield v
   }
   function* specialAttachPoints(): Generator<SpecialAttachPoint> {
      for (let seg of Segment.s) if (seg.isTether()) yield seg.centerPoint()
      for (let symbol of SymbolInstance.s)
         for (let p of symbol.specialAttachPoints) yield p
   }
   function* allCrossings(): Generator<Crossing> {
      for (let [seg1, map] of crossingMap) {
         for (let [seg2, crossing] of map) yield crossing
      }
   }
   function* allMovables(): Generator<Movable> {
      for (let m of Junction.s) yield m
      for (let m of SymbolInstance.s) yield m
   }
   function* allThingsWithProperties(): Generator<HasProperties> {
      for (let vertex of allVertices()) yield vertex
      for (let segment of Segment.s) yield segment
      for (let symbol of SymbolInstance.s) yield symbol
   }
   function closestNearTo<T extends Object2D>(
      point: Point,
      ...objectSets: Iterable<T>[]
   ): ClosenessResult<T> {
      let closest = closestTo(point, ...objectSets)
      if (
         closest &&
         closest.closestPart.sqDistanceFrom(point) <
            sqInteractRadius / cameraZoom // divisor intentionally nonsquared
      ) {
         return closest
      }
   }
   function closestSegmentNearTo(
      point: Point,
      alongAxis: Axis,
      segments: Iterable<Segment> = Segment.s
   ): ClosenessResult<Segment> {
      let closest = closestSegmentTo(point, alongAxis, segments)
      if (closest) {
         let segment = closest.object
         let c = closest.closestPart
         if (
            // the "cameraZoom" divisor is intentionally non-squared
            c.sqDistanceFrom(point) < sqInteractRadius / cameraZoom &&
            [segment.start, segment.end, ...segment.attachments].every(
               (v) => c.sqDistanceFrom(v) >= sqSegmentIntersectBuffer
            )
         ) {
            return closest
         }
      }
   }
   function closestAttachable(point: Point): ClosenessResult<Attachable> {
      return (
         closestNearTo(point, allVertices()) ||
         (specialAttachPointsVisible
            ? closestNearTo(point, specialAttachPoints())
            : undefined) ||
         closestNearTo(
            point,
            [...Segment.s].filter((s) => !s.isTether())
         )
      )
   }
   function closestGrabbable(point: Point): ClosenessResult<Grabbable> {
      let symbols = config.showSymbols.state === "on" ? SymbolInstance.s : []
      return (
         closestNearTo(point, Junction.s) ||
         closestNearTo(point, symbols) ||
         closestNearTo(point, Segment.s)
      )
   }
   function closestInteractable(point: Point): ClosenessResult<Interactable> {
      let symbols = config.showSymbols.state === "on" ? SymbolInstance.s : []
      return (
         closestNearTo<Vertex | Crossing>(
            point,
            allVertices(),
            allCrossings()
         ) ||
         closestNearTo(point, symbols) ||
         closestNearTo(point, Segment.s)
      )
   }
   function amassTarget(point: Point): ClosenessResult<Interactable> {
      return closestInteractable(point)
   }
   function warpTarget(point: Point): ClosenessResult<Grabbable> {
      return closestGrabbable(point)
   }
   function slideTarget(point: Point): ClosenessResult<Grabbable> {
      return closestGrabbable(point)
   }
   function drawTarget(point: Point): ClosenessResult<Attachable> {
      return closestAttachable(point)
   }
   function eraseTarget(point: Point): ClosenessResult<Grabbable> {
      return closestGrabbable(point)
   }
   function freezeTarget(point: Point): ClosenessResult<Segment> {
      return closestNearTo(point, Segment.s)
   }
   // ✨ A magical easing function for aesthetically-pleasing snapping. The
   // source is displaced from its true position as it approaches the target.
   function easeFn(distance: number): number {
      const a =
         (snapRadius - snapJump) /
         (sqSnapRadius + sqEaseRadius - 2 * snapRadius * easeRadius)
      const b = -2 * a * easeRadius
      const c = -a * sqEaseRadius - b * easeRadius
      return a * distance * distance + b * distance + c
   }
   function layerOf(point: Point): "lower" | "upper" {
      return point instanceof Port ||
         point instanceof SpecialAttachPoint ||
         touchLight.has(point as any) ||
         amassLight.has(point as any) ||
         point === draw?.segment.end
         ? "upper"
         : "lower"
   }
   // Computes the most frequent color amongst the edges of the given vertex.
   function colorOf(vertex: Vertex, ignoreTypeColor: boolean): string {
      if (vertex.edges().size === 0) return ""
      let counts = new DefaultMap<string, number>(() => 0)
      for (let [segment] of vertex.edges()) {
         let color = ignoreTypeColor ? segment.color : segment.renderColor()
         counts.set(color, counts.read(color) + 1)
      }
      return [...counts].reduce((prev, curr) =>
         curr[1] > prev[1] ? curr : prev
      )[0]
   }
   $: willBeDeleted = (item?: Segment | SymbolInstance | Glyph): boolean => {
      if (!item || !eraseRect) return false
      if (item instanceof Segment || item instanceof SymbolInstance) {
         return eraseRect.items.has(item)
      } else if (item.type === "vertex glyph") {
         if (item.vertex instanceof SpecialAttachPoint) {
            return willBeDeleted(item.vertex.object)
         } else {
            let m = movableAt(item.vertex)
            if (m instanceof Junction) {
               return [...m.edges()].every(([seg]) => eraseRect?.items.has(seg))
            } else {
               return eraseRect.items.has(m)
            }
         }
      } else {
         return item.segment ? eraseRect.items.has(item.segment) : false
      }
   }
   function isMoreHorizontal(subject: Segment, other: Segment): boolean {
      let rSeg = subject.axis.scalarRejectionFrom(Axis.horizontal)
      let rOther = other.axis.scalarRejectionFrom(Axis.horizontal)
      if (Math.abs(rSeg) < Math.abs(rOther)) {
         return true
      } else if (Math.abs(rSeg) > Math.abs(rOther)) {
         return false
      } else {
         return rSeg < rOther // tie breaker
      }
   }
   function nearestAxis(to: Axis, ofAxes: Axis[]): Axis {
      if (ofAxes.length === 0) return to
      let scores = ofAxes.map((axis) => Math.abs(to.dot(axis)))
      return ofAxes[scores.indexOf(Math.max(...scores))]
   }
   function selectedDrawMode(): DrawMode {
      return keyInfo.read(Shift).pressing
         ? config.angleSnap.state === "on"
            ? "snapped rotation"
            : "free rotation"
         : "strafing"
   }
   function selectedSlideMode(): SlideMode {
      return keyInfo.read(Shift).pressing ? "push connected" : "push all"
   }
   function selectedWarpMode(): WarpMode {
      return keyInfo.read(Shift).pressing ? "rotate" : "pan"
   }
   function labelOfButton(s: string): string {
      if (s.endsWith("Button")) return s[0].toUpperCase()
      else return s[0].toUpperCase() + s.slice(1)
   }
   function copyPositions(): DefaultMap<Movable, Point> {
      let positions = new DefaultMap<Movable, Point>(() => Point.zero)
      for (let j of Junction.s) positions.set(j, j.copy())
      for (let s of SymbolInstance.s) positions.set(s, s.position.copy())
      return positions
   }
   function copySymbolRotations(): DefaultMap<SymbolInstance, Rotation> {
      let rotations = new DefaultMap<SymbolInstance, Rotation>(
         () => Rotation.zero
      )
      for (let symbol of SymbolInstance.s)
         rotations.set(symbol, symbol.rotation)
      return rotations
   }
   // Returns the "shadow" each circuit element casts onto the given vector.
   // Only circuit elements parallel or orthogonal to the vector are considered.
   function projectionOfCircuitOnto(
      vector: Vector,
      pad: number = 0
   ): Map<Pushable, Range1D> {
      if (vector.sqLength() === 0) return new Map()

      let ranges = new Map<Pushable, Range1D>()
      let vectorAxis = Axis.fromVector(vector) as Axis
      let axesConsidered = [vectorAxis, vectorAxis.orthogonal()]

      for (let junction of Junction.s) {
         let s = junction
            .displacementFrom(Point.zero)
            .scalarProjectionOnto(vector)
         ranges.set(junction, new Range1D([s], pad))
      }
      for (let segment of Segment.s) {
         if (axesConsidered.includes(segment.axis))
            ranges.set(
               segment,
               new Range1D(
                  [
                     segment.start
                        .displacementFrom(Point.zero)
                        .scalarProjectionOnto(vector),
                     segment.end
                        .displacementFrom(Point.zero)
                        .scalarProjectionOnto(vector),
                  ],
                  pad
               )
            )
      }
      for (let symbol of SymbolInstance.s) {
         let symbolAxis = Axis.horizontal.rotatedBy(symbol.rotation)
         if (axesConsidered.includes(symbolAxis))
            ranges.set(symbol, rangeAlong(vector, symbol))
      }
      function rangeAlong(dir: Vector, symbol: SymbolInstance): Range1D {
         return new Range1D(
            symbol
               .corners()
               .map((corner) =>
                  corner.displacementFrom(Point.zero).scalarProjectionOnto(dir)
               ),
            pad
         )
      }
      return ranges
   }
   function absolutePosition(p: Point) {
      return `position: absolute; left: ${p.x}px; top: ${p.y}px`
   }
   $: windowCoordsToCanvasCoords = (p: Point): Point => {
      let offset = p.displacementFrom(canvasCenter).scaledBy(1 / cameraZoom)
      return cameraPosition.displacedBy(offset)
   }
   $: canvasCoordsToWindowCoords = (p: Point): Point => {
      let offset = p.displacementFrom(cameraPosition).scaledBy(cameraZoom)
      return canvasCenter.displacedBy(offset)
   }
   function mouseWheelIncrements(event: WheelEvent): number {
      return (event as any).wheelDeltaY / (120 * window.devicePixelRatio)
   }
   async function openProjectFolder() {
      if (!usingElectron || !worker) return
      if (projectFolder && history.timestampOfLastSave !== history.timestamp) {
         // Save the current project.
         let save = await worker.saveHistory(
            path.join(projectFolder, autosaveFileName)
         )
         if (
            save.outcome !== "success" &&
            !confirm(
               `Failed to save the current project.\nReason: ${save.error.message}\nDo you still wish to load a different project?`
            )
         )
            return
      }
      let response = await openDirectory()
      if (!response) return
      projectFolder = response
      let load1 = getFileNames(path.join(projectFolder, symbolFolderName)).then(
         async (fileNames) => {
            symbolLoadError = !fileNames
            if (fileNames) {
               await loadSymbols(
                  symbolFolderName,
                  fileNames.filter((f) => path.extname(f) === ".svg")
               ).then((kinds) => {
                  symbols = kinds
               })
            }
         }
      )
      let load2 = getFileNames(
         path.join(projectFolder, vertexGlyphFolderName)
      ).then(async (fileNames) => {
         if (fileNames) {
            await loadSymbols(
               vertexGlyphFolderName,
               fileNames.filter((f) => path.extname(f) === ".svg")
            ).then((kinds) => {
               vertexGlyphs = kinds
            })
         }
      })
      let load3 = getFileNames(
         path.join(projectFolder, crossingGlyphFolderName)
      ).then(async (fileNames) => {
         if (fileNames) {
            await loadSymbols(
               crossingGlyphFolderName,
               fileNames.filter((f) => path.extname(f) === ".svg")
            ).then((kinds) => {
               crossingGlyphs = kinds
            })
         }
      })
      let load4 = getFileNames(
         path.join(projectFolder, lineTypeFolderName)
      ).then(async (fileNames) => {
         lineTypeLoadError = !fileNames
         if (fileNames) {
            await loadLineTypes(
               fileNames.filter(
                  (f) => path.extname(f) === ".json" && f !== lineTypeConfigFile
               )
            ).then((types) => {
               lineTypes = new Set([tetherLineType, ...types])
               selectedLineType = tetherLineType
            })
         }
      })
      let load5 = loadLineTypeConfig()
         .then((config) => {
            lineTypeConfig = config
         })
         .catch(() => {
            lineTypeConfig = null
         })
      let loadHistory = worker.loadHistory(
         path.join(projectFolder, autosaveFileName)
      )
      Promise.all([loadHistory, load1, load2, load3, load4, load5])
         .then(([historyLoading]) => {
            let defaultLineType = lineTypeConfig?.selectedByDefault
            if (defaultLineType)
               for (let type of lineTypes)
                  if (type.name === defaultLineType) selectedLineType = type
            if (historyLoading.outcome === "success") {
               history = historyLoading.history
               loadState(history.stack[history.index].state)
               resetCamera()
            } else {
               console.error(
                  `Failed to load the project's history. Reason:\n${historyLoading.error.message}`
               )
               history = emptyHistory()
            }
         })
         .catch((error: Error) => {
            console.error(
               `Failed to load the project. Reason:\n${error.message}`
            )
         })
   }
   async function getFileNames(directory: string) {
      try {
         return await fs.readdir(directory)
      } catch {
         return null
      }
   }
   function assetFilePath(folderName: string, fileName: string): string {
      if (usingElectron && projectFolder) {
         return "file://" + path.join(projectFolder, folderName, fileName)
      } else {
         return `project template/${folderName}/${fileName}`
      }
   }
   async function loadSymbols(
      folderName: string,
      fileNames: string[]
   ): Promise<Set<SymbolKind>> {
      let s = new Set<SymbolKind>()
      await Promise.all(
         fileNames.map((fileName) =>
            fetch(assetFilePath(folderName, fileName))
               .then((response) => response.text())
               .then((text) => {
                  let kind = SymbolKind.new(fileName, text)
                  if (kind) s.add(kind)
               })
         )
      )
      return s
   }
   async function loadBuiltInGlyph(fileName: string): Promise<SymbolKind> {
      return fetch(`${builtinGlyphFolderName}/${fileName}`)
         .then((response) => response.text())
         .then((text) => {
            let kind = SymbolKind.new(fileName, text)
            if (kind) return kind
            else throw "Failed to load built-in symbol."
         })
   }
   async function loadLineTypes(fileNames: string[]): Promise<Set<LineType>> {
      let s = new Set<LineType>()
      await Promise.all(
         fileNames.map((fileName) =>
            fetch(assetFilePath(lineTypeFolderName, fileName))
               .then((response) => response.json())
               .then((json: LineType) => {
                  json.name = fileName.replace(".json", "")
                  if (json.meeting) {
                     // Wrap the "meeting" dict in a Proxy such that it returns an
                     // empty record for missing line types.
                     json.meeting = new Proxy(json.meeting, {
                        get: (object, prop) => {
                           return prop in object ? object[prop] : {}
                        },
                     })
                  }
                  s.add(json)
               })
         )
      )
      return s
   }
   async function loadLineTypeConfig(): Promise<LineTypeConfig> {
      return fetch(assetFilePath(lineTypeFolderName, lineTypeConfigFile))
         .then((response) => response.json())
         .then((json: LineTypeConfig) => {
            return json
         })
   }
   type Time = number & {} // in milliseconds (since whenever)
   type Duration = number & {} // in milliseconds
   function now(): Time {
      return performance.now()
   }
   function seconds(n: number): Duration {
      return n * 1000
   }
   function timeSince(time: Time): Duration {
      return now() - time
   }
   function loadState(state: CircuitJSON) {
      resetOperationVariables()
      loadFromJSON(
         state,
         new Map([...symbols].map((s) => [s.fileName, s])),
         new Map([...lineTypes].map((t) => [t.name, t])),
         crossingMap
      )
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
      amassed.items = amassed.items
   }

   // -------------- State of input peripherals (not persisted) ---------------
   let mouseInClient: Point = Point.zero
   let usingTrackpad = false
   let mouselikeWheelEvents = 0
   let timeOfLastWheelEvent: Time = now()
   let lastYMagnitude = 0
   const [LMB, MMB, RMB, Shift, Alt, Control] = [
      "LMB",
      "MMB",
      "RMB",
      "Shift",
      "Alt",
      "Control",
   ]
   let keyInfo = new DefaultMap<
      string,
      (
         | { type: "none" | "pan" | "delete" | "useTool" | "abort" }
         | { type: "holdTool"; tool: Tool }
      ) & {
         pressing: boolean
      }
   >(() => {
      return { type: "none", pressing: false }
   }, [
      [MMB, { type: "pan", pressing: false }],
      ["Space", { type: "pan", pressing: false }],
      ["Backspace", { type: "delete", pressing: false }],
      ["Delete", { type: "delete", pressing: false }],
      //["KeyQ", { type: "holdTool", tool: "query", pressing: false }],
      ["KeyW", { type: "holdTool", tool: "warp", pressing: false }],
      ["KeyE", { type: "holdTool", tool: "erase", pressing: false }],
      //["KeyR", { type: "holdTool", tool: "rButton", pressing: false }],
      ["KeyA", { type: "holdTool", tool: "amass", pressing: false }],
      ["KeyS", { type: "holdTool", tool: "slide", pressing: false }],
      ["KeyD", { type: "holdTool", tool: "draw", pressing: false }],
      ["KeyF", { type: "holdTool", tool: "freeze", pressing: false }],
      [LMB, { type: "useTool", pressing: false }],
      ["Escape", { type: "abort", pressing: false }],
   ])
   let spacebarTap:
      | { state: "initial" }
      | {
           state: "pressed" | "tapped"
           timeOfAction: Time
           placeOfAction: Point // in client coordinates
        } = {
      state: "initial",
   }
   function spacebarTapIsFresh(): boolean {
      if (spacebarTap.state === "initial") {
         return false
      } else {
         return (
            timeSince(spacebarTap.timeOfAction) < maxDoubleTapInterval &&
            mouseInClient.distanceFrom(spacebarTap.placeOfAction) <
               maxDoubleTapMove
         )
      }
   }

   // ---------------------- Editor state (not persisted) ---------------------
   // Note: This is the state of the editor. The circuit is stored elsewhere.
   let [canvasWidth, canvasHeight] = [800, 600]
   let pasteOffset = new Vector(0, 0) // offset for repeated pasting

   let projectFolder: null | string = null
   let symbols = new Set<SymbolKind>()
   let vertexGlyphs = new Set<SymbolKind>()
   let crossingGlyphs = new Set<SymbolKind>()
   let vertexMarkerGlyph: SymbolKind | undefined
   let crossingMarkerGlyph: SymbolKind | undefined
   let attachMarkerGlyph: SymbolKind | undefined
   let lineTypes = new Set<LineType>()
   let lineTypeConfig: null | LineTypeConfig = null
   // If we're not using Electron, load test symbols.
   if (!usingElectron) {
      loadSymbols(symbolFolderName, symbolsForBrowserTesting).then((kinds) => {
         symbols = kinds
      })
      loadSymbols(vertexGlyphFolderName, vertexGlyphsForBrowserTesting).then(
         (kinds) => {
            vertexGlyphs = kinds
         }
      )
      loadSymbols(
         crossingGlyphFolderName,
         crossingGlyphsForBrowserTesting
      ).then((kinds) => {
         crossingGlyphs = kinds
      })
      let load1 = loadLineTypes(lineTypesForBrowserTesting).then((types) => {
         lineTypes = new Set([tetherLineType, ...types])
         selectedLineType = tetherLineType
      })
      let load2 = loadLineTypeConfig()
         .then((config) => {
            lineTypeConfig = config
         })
         .catch(() => {
            lineTypeConfig = null
         })
      Promise.all([load1, load2]).then(() => {
         let defaultLineType = lineTypeConfig?.selectedByDefault
         if (defaultLineType)
            for (let type of lineTypes)
               if (type.name === defaultLineType) selectedLineType = type
      })
   }
   loadBuiltInGlyph(vertexMarkerFileName).then((glyph) => {
      vertexMarkerGlyph = glyph
   })
   loadBuiltInGlyph(crossingMarkerFileName).then((glyph) => {
      crossingMarkerGlyph = glyph
   })
   loadBuiltInGlyph(attachMarkerFileName).then((glyph) => {
      attachMarkerGlyph = glyph
   })
   let symbolLoadError = false
   let lineTypeLoadError = false
   function findVertexGlyph(
      fileName: string | null | undefined
   ): SymbolKind | undefined {
      for (let g of vertexGlyphs) if (g.fileName === fileName) return g
   }
   function findCrossingGlyph(
      fileName: string | null | undefined
   ): SymbolKind | undefined {
      for (let g of crossingGlyphs) if (g.fileName === fileName) return g
   }

   // Initialize the Web Worker that handles saving and loading.
   let worker: null | Comlink.Remote<WorkerInterface>
   if (usingElectron) {
      worker = Comlink.wrap(
         new Worker(
            new URL("../saveLoadWorker.ts", import.meta.url), // per Vite docs
            { type: "module" }
         )
      )
   }
   // Whenever a change is made to this data structure, a corresponding
   // change must be made to the "twin" data structure within the Web Worker.
   let history: CircuitHistory<CircuitJSON> = emptyHistory()

   function emptyHistory(): CircuitHistory<CircuitJSON> {
      return {
         stackSizeLimit: 200,
         stack: [{ state: emptyCircuitJSON, description: "blank canvas" }],
         index: 0,
         timestamp: 0,
         timestampOfLastSave: 0,
      }
   }
   function commitState(description: string) {
      history.stack.length = history.index + 1 // Forget undone states.
      let state = saveToJSON()
      history.stack.push({ state, description })
      if (history.stack.length > history.stackSizeLimit) {
         history.stack = history.stack.slice(1) // drop the oldest state
      } else {
         ++history.index
      }
      history.timestamp += 1
      history.stack = history.stack // for Svelte
      worker?.commitState(state, description)
   }
   function executeUndo() {
      if (history.index > 0) {
         --history.index
         loadState(history.stack[history.index].state)
      }
      history.timestamp += 1
      worker?.executeUndo()
   }
   function executeRedo() {
      let lastIndex = history.stack.length - 1
      if (history.index < lastIndex) {
         ++history.index
         loadState(history.stack[history.index].state)
      }
      history.timestamp += 1
      worker?.executeRedo()
   }
   function executeTimeTravel(historyIndex: number) {
      history.index = historyIndex
      loadState(history.stack[history.index].state)
      history.timestamp += 1
      worker?.executeTimeTravel(historyIndex)
   }
   async function autosave() {
      if (!projectFolder || !worker) return
      if (history.timestampOfLastSave === history.timestamp) return

      let save = await worker.saveHistory(
         path.join(projectFolder, autosaveFileName)
      )
      if (save.outcome === "success") {
         console.log("Autosaved.")
         history.timestampOfLastSave = save.timestampOfSave
      } else {
         console.error(`Autosave failed. Reason:\n${save.error.message}`)
      }
   }
   let intervalI = setInterval(autosave, autosaveFrequency) as unknown as number
   // A hack to clear old intervals during hot reloading:
   for (let i = 0; i < intervalI; ++i) clearInterval(i)

   let grabbedSymbol: { kind: SymbolKind; grabOffset: Vector } | null = null

   // The "boundTool" is the tool that will be used when no keyboard keys of
   // type "holdTool" are being pressed.
   let boundTool: Tool = "draw"
   // When a "holdTool" key is pressed, it assigns a "heldTool". When the key
   // is released, "heldTool" is reset to null.
   let heldTool: null | { tool: Tool; shouldBind: boolean } = null
   // If there is a "heldTool", use that. Otherwise, use the "boundTool".
   $: toolToUse = heldTool ? heldTool.tool : boundTool
   // The tool of the operation currently in-progress (if any).
   let toolBeingUsed: null | {
      tool: Tool
      canvasDownPosition: Point
      chainDrawFromEnd?: Vertex // Special field for the draw tool.
   } = null

   let selectedLineType: null | LineType = null
   let lineTypeToUse: null | LineType
   $: {
      // By default, use the selected line type.
      lineTypeToUse = selectedLineType
      // If beginning a draw operation at a vertex whose edges (ignoring
      // tethers) all have the same line type, use that line type instead.
      let target = drawTarget(
         toolBeingUsed ? toolBeingUsed.canvasDownPosition : mouseOnCanvas
      )
      if (toolToUse === "draw" && target && isVertex(target.object)) {
         let typeNames = new Set(
            [...target.object.edges()]
               .map(([segment]) => segment.type.name)
               .filter((name) => name !== tetherLineType.name)
         )
         if (typeNames.size === 1) {
            let name = [...typeNames][0]
            let type = [...lineTypes].filter((t) => t.name === name)[0]
            lineTypeToUse = type
         }
      }
   }

   let committedCameraPosition: Point = Point.zero // Position on the canvas.
   let cameraZoom: number = 1

   const onAndOff = ["on", "off"] as const
   type OnOrOff = typeof onAndOff[number]
   const stdHalfAndOff = [standardGap, halfGap, "off"] as const
   type StdHalfOrOff = typeof stdHalfAndOff[number]
   let config = {
      distanceSnap: {
         tooltip: "Snap to a standard distance?",
         icon: "icons/distanceSnap.svg",
         values: stdHalfAndOff,
         state: standardGap as StdHalfOrOff,
      },
      // distanceWarn: {
      //    tooltip: "Warn when distances are slightly askew?",
      //    icon: "icons/distanceWarn.svg",
      //    values: onAndOff,
      //    state: "on" as OnOrOff,
      // },
      angleSnap: {
         tooltip: "Snap to common angles?",
         icon: "icons/angleSnap.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
      // angleWarn: {
      //    tooltip: "Warn when angles are slightly askew?",
      //    icon: "icons/angleWarn.svg",
      //    values: onAndOff,
      //    state: "on" as OnOrOff,
      // },
      showSymbols: {
         tooltip: "Show symbols?",
         icon: "icons/symbols.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
      showSymbolSnaps: {
         tooltip: "Show ports and collision boxes?",
         icon: "icons/symbolSnaps.svg",
         values: onAndOff,
         state: "off" as OnOrOff,
      },
      showTethers: {
         tooltip: "Show tethers?",
         icon: "icons/tethers.svg",
         values: onAndOff,
         state: "on" as OnOrOff,
      },
   }
   function toggleConfig(item: typeof config[keyof typeof config]) {
      let i = item.values.indexOf(item.state as any)
      item.state = item.values[(i + 1) % item.values.length]
      config = config // Inform Svelte of change.
   }

   // Avoid highlighting this item until the mouse is moved away from the
   // specified position. (This is just a "trick" to make highlighting nicer.)
   let doNotLightUp:
      | { item: Interactable; clientPosition: Point }
      | { item: null } = {
      item: null,
   }
   const sqLightUpDistance = sqInteractRadius

   // The following variables track the state of operations that are in-progress
   let pan: null | { clientDownPosition: Point } = null
   type DrawMode = "strafing" | "snapped rotation" | "free rotation"
   let draw: null | {
      mode: DrawMode
      segment: Segment
      end: Junction
      segmentIsNew: boolean
      endObject?: Attachable
      drawAxisRanges?: Map<Pushable, Range1D>
      orthoRanges?: Map<Pushable, Range1D>
   }
   type SlideInstruction = {
      movable: Movable
      delay: number
      isPush: boolean
   }
   type SlideMode = "push connected" | "push all"
   let slide: null | {
      mode: SlideMode
      originalPositions: DefaultMap<Movable | Vertex, Point>
      grabbed: Grabbable
      start: Point
      axis: Axis
      posInstructions: SlideInstruction[]
      negInstructions: SlideInstruction[]
      contactPositions: number[]
      rigidSegments: Set<Segment> //segments whose rigidity affects the movement
      immediatelyMoved: Set<Segment>
   } = null
   type WarpMode = "pan" | "rotate"
   let warp: null | {
      mode: WarpMode
      grabbed: Grabbable
      movables: Set<Movable>
      centroid: Point
      keyRotations: Set<Rotation>
      incidentEdges: Set<Edge> // edges incident to movables, but not in-between
      affectedSegments: Set<Segment> // segments that may be altered by the warp
      rigidSegments: Set<Segment> //segments whose rigidity affects the movement
      originalPositions: DefaultMap<Movable, Point>
      originalRotations: DefaultMap<SymbolInstance, Rotation>
      start: Point
      splice: null | { source: Port | [Port, Port]; target: Segment }
      highlight: Set<Port | Segment> // highlight for splicing and port snapping
   }
   let amassRect: null | {
      mode: "add" | "remove"
      start: Point
      items: Set<Interactable>
   } = null
   let eraseRect: null | {
      start: Point
      items: Set<Segment | SymbolInstance>
   } = null
   $: {
      for (let symbol of SymbolInstance.s) {
         let display = willBeDeleted(symbol) ? "none" : "initial"
         symbol.image.style.display = display
         symbol.highlight.style.display = display
      }
   }
   let freezeRect: null | {
      mode: "add" | "remove"
      start: Point
      items: Set<Segment>
   }

   function resetOperationVariables() {
      endPan() // Don't revert this, just end it.
      grabbedSymbol = null
      toolBeingUsed = null
      draw = null
      slide = null
      warp = null
      amassRect = null
      eraseRect = null
      freezeRect = null
   }

   // ---------------------------- Derived state ------------------------------
   $: canvasCenter = new Point(canvasWidth / 2, canvasHeight / 2)
   $: computeCameraPosition = (): Point => {
      // This function is an indirection (a hack) for allowing `cameraPosition`
      // to be updated reactively AND manually.
      if (pan) {
         let d = pan.clientDownPosition
            .displacementFrom(mouseInClient)
            .scaledBy(1 / cameraZoom)
         return committedCameraPosition.displacedBy(d)
      } else {
         return committedCameraPosition
      }
   }
   $: cameraPosition = computeCameraPosition()
   $: computeMouseOnCanvas = (): Point => {
      // This function is an indirection (a hack) for allowing `mouseOnCanvas`
      // to be updated reactively AND manually.
      if (canvas) {
         let canvasRect = canvas.getBoundingClientRect()
         let positionInCanvasWindow = new Point(
            mouseInClient.x - canvasRect.left,
            mouseInClient.y - canvasRect.top
         )
         return windowCoordsToCanvasCoords(positionInCanvasWindow)
      } else {
         return Point.zero
      }
   }
   $: mouseOnCanvas = computeMouseOnCanvas()
   $: currentCursor = toolBeingUsed?.tool || toolToUse
   let svgTranslate: Vector
   $: {
      let windowTopLeft = windowCoordsToCanvasCoords(Point.zero)
      svgTranslate = new Vector(-windowTopLeft.x, -windowTopLeft.y)
   }
   let orderedLineTypes: LineType[]
   $: {
      if (lineTypeConfig) {
         orderedLineTypes = []
         let remaining = new Set(lineTypes)
         for (let name of lineTypeConfig.sidebarOrder) {
            for (let type of lineTypes) {
               if (type.name === name) {
                  orderedLineTypes.push(type)
                  remaining.delete(type)
                  break
               }
            }
         }
         let sortedRemaining = [...remaining].sort((a, b) => {
            return a.name < b.name ? -1 : 1
         })
         orderedLineTypes.push(...sortedRemaining)
      } else {
         orderedLineTypes = [...lineTypes]
      }
   }
   let crossingMap: DefaultMap<Segment, Map<Segment, Crossing>>
   $: /* Determine which Segments are crossing, and where they cross. */ {
      let oldCrossingMap = crossingMap
      crossingMap = new DefaultMap(() => new Map())
      for (let seg1 of Segment.s) {
         for (let seg2 of Segment.s) {
            if (seg1.connectsTo(seg2)) continue
            let crossPoint = seg1.intersection(seg2)
            if (crossPoint) {
               let ends = [seg1.start, seg1.end, seg2.start, seg2.end]
               let minSqDistance = Math.min(
                  ...ends.map((p) => p.sqDistanceFrom(crossPoint as Point))
               )
               if (minSqDistance >= sqSegmentCrossingBuffer) {
                  let crossing = oldCrossingMap.read(seg1).get(seg2)
                  if (crossing) {
                     crossing.point = crossPoint
                  } else {
                     crossing = new Crossing(seg1, seg2, crossPoint)
                  }
                  crossingMap.getOrCreate(seg1).set(seg2, crossing)
                  crossingMap.getOrCreate(seg2).set(seg1, crossing)
               }
            }
         }
      }
   }
   let rigidLight: Set<Segment>
   $: {
      rigidLight = new Set()
      if (toolToUse === "freeze") {
         for (let s of Segment.s) if (s.isRigid()) rigidLight.add(s)
         if (freezeRect) {
            if (freezeRect.mode === "remove") {
               for (let item of freezeRect.items)
                  if (item.isFrozen) rigidLight.delete(item)
            } else {
               for (let item of freezeRect.items) rigidLight.add(item)
            }
         }
      } else {
         for (let s of rigidlyMovedSegments) rigidLight.add(s)
      }
   }
   let touchLight: Set<Interactable | SpecialAttachPoint>
   $: {
      touchLight = new Set()
      if (document.hasFocus() /* hasFocus => the mouse position is fresh */) {
         let tool = toolBeingUsed?.tool || toolToUse
         let touchLocation = toolBeingUsed?.canvasDownPosition || mouseOnCanvas
         let touching: Interactable | SpecialAttachPoint | undefined
         if (tool === "amass" && !amassRect) {
            touching = amassTarget(touchLocation)?.object
         } else if (tool === "warp") {
            touching = warp ? warp.grabbed : warpTarget(touchLocation)?.object
         } else if (tool === "slide") {
            touching = slide
               ? slide.grabbed
               : slideTarget(touchLocation)?.object
         } else if (draw?.endObject) {
            touching = draw.endObject
         } else if (tool === "draw" && !draw) {
            touching = drawTarget(touchLocation)?.object
         } else if (tool === "erase" && !eraseRect) {
            touching = eraseTarget(touchLocation)?.object
         } else if (tool === "freeze" && !freezeRect) {
            touching = freezeTarget(touchLocation)?.object
         }
         if (touching) {
            // If touching part of an amassment, highlight all of it.
            // Otherwise, just highlight the thing being touched.
            if (tool !== "amass" && amassed.items.has(touching as any)) {
               for (let item of amassed.items) touchLight.add(item)
            } else if (touching !== doNotLightUp.item) {
               touchLight.add(touching)
            }
         }
      }
      // A bit of extra highlighting.
      if (warp?.highlight) {
         for (let thing of warp.highlight) touchLight.add(thing)
      }
   }
   let amassLight: Set<Interactable>
   $: {
      amassLight = new Set(amassed.items)
      if (amassRect) {
         if (amassRect.mode === "remove") {
            for (let item of amassRect.items) amassLight.delete(item)
         } else {
            for (let item of amassRect.items) amassLight.add(item)
         }
      }
   }
   $: /* Apply highlighting to symbols. */ {
      // Dynamically assign the highlight of each Symbol to the required layer.
      // The color of a highlight is inherited from the layer it is assigned to.
      for (let symbol of SymbolInstance.s) {
         let show = config.showSymbols.state === "on"
         if (show && touchLight.has(symbol)) {
            document
               .getElementById("symbol touchLight layer")
               ?.appendChild(symbol.highlight)
         } else if (show && amassLight.has(symbol)) {
            document
               .getElementById("symbol amassLight layer")
               ?.appendChild(symbol.highlight)
         } else {
            symbol.highlight.remove()
         }
      }
   }
   type GlyphKind = "auto" | null | SymbolKind
   let vertexGlyphKinds: GlyphKind[]
   $: {
      vertexGlyphKinds = ["auto", null, ...vertexGlyphs]
   }
   let crossingGlyphKinds: GlyphKind[]
   $: {
      crossingGlyphKinds = ["auto", null, ...crossingGlyphs]
   }
   let inspectorItemSummary: string
   type InspectorMode =
      | {
           mode: "vertex"
           vertices: Set<Vertex>
           glyphs: Set<GlyphKind>
           glyphOrientations: GlyphOrientation | "both"
        }
      | {
           mode: "crossing"
           crossings: Set<Crossing>
           glyphs: Set<GlyphKind>
        }
      | { mode: "segment"; segments: Set<Segment>; color: string | "mixed" }
      | { mode: "symbol"; symbols: Set<SymbolInstance>; canFlip: boolean }
      | { mode: "mixed" }
   type TagInfo = { tag: Tag; count: number }
   type PropertyInfo = { property: Property; count: number }
   let inspector:
      | (InspectorMode & {
           items: Set<Interactable>
           tags: TagInfo[]
           properties: PropertyInfo[]
        })
      | { mode: null }
   let newlyAddedTag: Tag | undefined
   let newlyAddedProperty: PropertyString | undefined
   let tagSortOrder: Tag[] = []
   let propertySortOrder: PropertyString[] = []
   $: {
      // Before resetting variables, ensure that if a property is being edited
      // in the (outdated) inspector right now, the edited value is saved.
      // (A crucial assumption here is that whenever this code is being
      // executed, it is acceptable to de-focus the current input element.)
      let e = document.activeElement
      if (e instanceof HTMLInputElement && e.classList.contains("textBoxInput"))
         e.blur()
      // Reset the sort orders whenever the items being inspected have changed.
      let itemsToInspect = new Set(amassed.items)
      if (inspector?.mode && !sameSet(itemsToInspect, inspector.items)) {
         newlyAddedTag = undefined
         newlyAddedProperty = undefined
         tagSortOrder = []
         propertySortOrder = []
      }
      // Reset variables.
      inspectorItemSummary = ""
      inspector = { mode: null }

      // Gather the tags and properties of the inspected items.
      let tagCounts = new DefaultMap<Tag, number>(() => 0)
      let propertyCounts = new DefaultMap<PropertyString, number>(() => 0)
      for (let item of itemsToInspect) {
         if (item instanceof Crossing) continue
         for (let tag of item.tags) tagCounts.set(tag, tagCounts.read(tag) + 1)
         for (let prop of item.properties)
            propertyCounts.set(prop, propertyCounts.read(prop) + 1)
      }
      let tags: TagInfo[] = []
      // If there is a pre-existing order, display tags in that order.
      for (let tag of tagSortOrder) {
         if (tagCounts.has(tag)) {
            tags.push({ tag, count: tagCounts.read(tag) })
            tagCounts.delete(tag)
         }
      }
      // Otherwise (or for remaining tags), display them lexicographically.
      for (let tag of [...tagCounts.keys()].sort()) {
         tags.push({ tag, count: tagCounts.read(tag) })
      }
      let properties: PropertyInfo[] = []
      // If there is a pre-existing order, display properties in that order.
      for (let prop of propertySortOrder) {
         if (propertyCounts.has(prop)) {
            properties.push({
               property: parseProperty(prop),
               count: propertyCounts.read(prop),
            })
            propertyCounts.delete(prop)
         }
      }
      // Otherwise (or for remaining properties), display them lexicographically
      for (let prop of [...propertyCounts.keys()].sort()) {
         properties.push({
            property: parseProperty(prop),
            count: propertyCounts.read(prop),
         })
      }
      // Group items by their type.
      let items = [...itemsToInspect]
      let $vertices = items.filter((i) => isVertex(i)) as Vertex[]
      let $crossings = items.filter((i) => i instanceof Crossing) as Crossing[]
      let $segments = items.filter((i) => i instanceof Segment) as Segment[]
      let $symbols = items.filter(
         (i) => i instanceof SymbolInstance
      ) as SymbolInstance[]

      // Compute the summary text.
      let vertexText =
         $vertices.length > 1 ? `${$vertices.length} vertices` : "1 vertex"
      let crossingText =
         $crossings.length > 1 ? `${$crossings.length} crossings` : "1 crossing"
      let segmentText =
         $segments.length > 1 ? `${$segments.length} segments` : "1 segment"
      let symbolText =
         $symbols.length > 1 ? `${$symbols.length} symbols` : "1 symbol"
      let data = [
         [$vertices.length, vertexText] as const,
         [$crossings.length, crossingText] as const,
         [$segments.length, segmentText] as const,
         [$symbols.length, symbolText] as const,
      ]
         .filter((d) => d[0] > 0)
         .map((d) => d[1])
      if (data.length === 0) {
         inspectorItemSummary = "No items amassed."
      } else {
         inspectorItemSummary = data[0]
         for (let i = 1; i < data.length; ++i) {
            inspectorItemSummary += `, ${data[i]}`
         }
         inspectorItemSummary += "."
      }

      if (data.length === 1) {
         // Show configuration options specific to the type of item selected.
         if ($vertices.length > 0) {
            let glyphs = new Set<GlyphKind>(
               $vertices.map((vertex) =>
                  vertex.glyph.type === "auto"
                     ? "auto"
                     : vertex.glyph.glyph
                     ? findVertexGlyph(vertex.glyph.glyph) || null
                     : null
               )
            )
            let glyphOrientations: GlyphOrientation | "both"
            if ($vertices.every((v) => v.glyphOrientation === "fixed")) {
               glyphOrientations = "fixed"
            } else if (
               $vertices.every((v) => v.glyphOrientation === "inherit")
            ) {
               glyphOrientations = "inherit"
            } else {
               glyphOrientations = "both"
            }
            inspector = {
               mode: "vertex",
               vertices: new Set($vertices),
               glyphs,
               glyphOrientations,
               items: itemsToInspect,
               tags,
               properties,
            }
         } else if ($crossings.length > 0) {
            let glyphs = new Set<GlyphKind>(
               $crossings.map((crossing) => {
                  let c1 = crossing.seg1.crossingKinds.read(crossing.seg2)
                  let c2 = crossing.seg2.crossingKinds.read(crossing.seg1)
                  return c1.type === "auto" || c2.type === "auto"
                     ? "auto"
                     : c1.glyph
                     ? findCrossingGlyph(c1.glyph) || null
                     : findCrossingGlyph(c2.glyph) || null
               })
            )
            inspector = {
               mode: "crossing",
               crossings: new Set($crossings),
               glyphs,
               items: itemsToInspect,
               tags,
               properties,
            }
         } else if ($segments.length > 0) {
            let firstColor = $segments[0].color
            let color = $segments.every((seg) => seg.color === firstColor)
               ? firstColor
               : "mixed"
            inspector = {
               mode: "segment",
               segments: new Set($segments),
               color,
               items: itemsToInspect,
               tags,
               properties,
            }
         } else if ($symbols.length > 0) {
            let canFlip = $symbols.every((symbol) => symbol.edges().size === 0)
            inspector = {
               mode: "symbol",
               symbols: new Set($symbols),
               canFlip,
               items: itemsToInspect,
               tags,
               properties,
            }
         } else {
            // Show generic configuration options.
            inspector = {
               mode: "mixed",
               items: itemsToInspect,
               tags,
               properties,
            }
         }
      } else if (data.length > 1) {
         // Show generic configuration options.
         inspector = { mode: "mixed", items: itemsToInspect, tags, properties }
      }
   }
   function setVertexGlyphs(kind: GlyphKind) {
      if (inspector.mode !== "vertex") return
      let glyph: VertexGlyphKind
      if (kind === "auto") {
         glyph = { type: "auto" }
      } else if (kind === null) {
         glyph = { type: "manual", glyph: null }
      } else {
         glyph = { type: "manual", glyph: kind.fileName }
      }
      for (let vertex of inspector.vertices) vertex.glyph = glyph
      commitState(
         inspector.vertices.size > 1
            ? "change vertex glyphs"
            : "change vertex glyph"
      )
      Junction.s = Junction.s
      Port.s = Port.s
      amassed.items = amassed.items
   }
   function orientVertexGlyphs(orientation: GlyphOrientation) {
      if (inspector.mode !== "vertex") return
      for (let v of inspector.vertices) v.glyphOrientation = orientation
      commitState(
         inspector.vertices.size > 1
            ? "orient vertex glyphs"
            : "orient vertex glyph"
      )
      Junction.s = Junction.s
      Port.s = Port.s
      amassed.items = amassed.items
   }
   function setCrossingGlyphs(kind: GlyphKind) {
      if (inspector.mode !== "crossing") return
      for (let { seg1, seg2 } of inspector.crossings) {
         if (kind === "auto") {
            seg1.crossingKinds.set(seg2, { type: "auto" })
            seg2.crossingKinds.set(seg1, { type: "auto" })
         } else {
            let c1 = seg1.crossingKinds.read(seg2)
            let c2 = seg2.crossingKinds.read(seg1)
            let type = "manual" as const
            let glyph = kind?.fileName || null
            if (
               c1.type === "auto" ||
               c2.type === "auto" ||
               (!c1.glyph && !c2.glyph)
            ) {
               if (isMoreHorizontal(seg1, seg2)) {
                  const facing = seg1.start.x < seg1.end.x ? "left" : "right"
                  seg1.crossingKinds.set(seg2, { type, glyph, facing })
                  seg2.crossingKinds.set(seg1, { type, glyph: null, facing })
               } else {
                  const facing = seg2.start.x < seg2.end.x ? "left" : "right"
                  seg1.crossingKinds.set(seg2, { type, glyph: null, facing })
                  seg2.crossingKinds.set(seg1, { type, glyph, facing })
               }
            } else if (c1.glyph) {
               const facing = c1.facing
               seg1.crossingKinds.set(seg2, { type, glyph, facing })
               seg2.crossingKinds.set(seg1, { type, glyph: null, facing })
            } else {
               const facing = c2.facing
               seg1.crossingKinds.set(seg2, { type, glyph: null, facing })
               seg2.crossingKinds.set(seg1, { type, glyph, facing })
            }
         }
      }
      commitState(
         inspector.crossings.size > 1
            ? "change crossing glyphs"
            : "change crossing glyph"
      )
      Segment.s = Segment.s
      amassed.items = amassed.items
   }
   function rotateCrossingGlyphs(direction: "clockwise" | "anticlockwise") {
      if (inspector.mode !== "crossing") return
      for (let { seg1, seg2 } of inspector.crossings) {
         let c1 = seg1.crossingKinds.read(seg2)
         let c2 = seg2.crossingKinds.read(seg1)
         let dir1 = seg1.end.directionFrom(seg1.start)
         let dir2 = seg2.end.directionFrom(seg2.start)
         if (!dir1 || !dir2) continue
         let not = { left: "right", right: "left" } as const
         let type = "manual" as const
         if (c1.type === "auto" || c2.type === "auto") {
            if (isMoreHorizontal(seg1, seg2)) {
               let autoGlyph =
                  seg1.type.meeting?.[seg2.type.name].crossing || null
               let facing: "left" | "right"
               if (direction === "clockwise") {
                  facing = seg2.start.y < seg2.end.y ? "left" : "right"
               } else {
                  facing = seg2.start.y < seg2.end.y ? "right" : "left"
               }
               seg1.crossingKinds.set(seg2, { type, glyph: null, facing })
               seg2.crossingKinds.set(seg1, { type, glyph: autoGlyph, facing })
            } else {
               let autoGlyph =
                  seg2.type.meeting?.[seg1.type.name].crossing || null
               let facing: "left" | "right"
               if (direction === "clockwise") {
                  facing = seg1.start.y < seg1.end.y ? "left" : "right"
               } else {
                  facing = seg1.start.y < seg1.end.y ? "right" : "left"
               }
               seg1.crossingKinds.set(seg2, { type, glyph: autoGlyph, facing })
               seg2.crossingKinds.set(seg1, { type, glyph: null, facing })
            }
         } else if (c1.glyph) {
            const facing = dir2.rotationFrom(dir1)[direction]()
               ? c1.facing
               : not[c1.facing]
            seg1.crossingKinds.set(seg2, { type, glyph: null, facing })
            seg2.crossingKinds.set(seg1, { type, glyph: c1.glyph, facing })
         } else {
            const facing = dir1.rotationFrom(dir2)[direction]()
               ? c2.facing
               : not[c2.facing]
            seg1.crossingKinds.set(seg2, { type, glyph: c2.glyph, facing })
            seg2.crossingKinds.set(seg1, { type, glyph: null, facing })
         }
      }
      commitState(
         inspector.crossings.size > 1
            ? "rotate crossing glyphs"
            : "rotate crossing glyph"
      )
      Segment.s = Segment.s
   }
   function setColorOfSegments(color: string) {
      if (inspector.mode !== "segment") return
      if (color === "mixed") return //This string was for informational purposes
      let somethingChanged = false
      for (let segment of inspector.segments) {
         if (segment.color !== color) {
            segment.color = color
            somethingChanged = true
         }
      }
      if (somethingChanged) commitState("change segment color")
      Segment.s = Segment.s
   }
   function flipSymbols() {
      if (inspector.mode !== "symbol") return
      for (let symbol of inspector.symbols) symbol.flip()
      commitState("flip")
      SymbolInstance.s = SymbolInstance.s
   }
   function sendSymbolsToBack() {
      if (inspector.mode !== "symbol") return
      let $symbols = inspector.symbols
      let targets = SymbolInstance.s.filter((symbol) => $symbols.has(symbol))
      let rest = SymbolInstance.s.filter((symbol) => !$symbols.has(symbol))
      SymbolInstance.s = [...targets, ...rest]
      targets.reverse() // necessary because we are about to repeatedly prepend
      for (let symbol of targets) symbol.applySendToBack()
      commitState("send to back")
      SymbolInstance.s = SymbolInstance.s
   }
   function bringSymbolsToFront() {
      if (inspector.mode !== "symbol") return
      let $symbols = inspector.symbols
      let targets = SymbolInstance.s.filter((symbol) => $symbols.has(symbol))
      let rest = SymbolInstance.s.filter((symbol) => !$symbols.has(symbol))
      SymbolInstance.s = [...rest, ...targets]
      for (let symbol of targets) symbol.applyBringToFront()
      commitState("bring to front")
      SymbolInstance.s = SymbolInstance.s
   }
   function randomTag(): Tag {
      let tag = ""
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      const numbers = "0123456789"
      for (let i = 0; i < 2; ++i)
         tag += letters.charAt(Math.floor(Math.random() * letters.length))
      tag += "-"
      for (let i = 0; i < 2; ++i)
         tag += numbers.charAt(Math.floor(Math.random() * numbers.length))
      return tag
   }
   function addEmptyTag() {
      if (!inspector.mode) return
      newlyAddedTag = emptyTag
      for (let item of inspector.items) {
         if (item instanceof Crossing) continue
         item.tags.add(newlyAddedTag)
      }
      tagSortOrder = [newlyAddedTag] // Put the new tag first.
      for (let { tag } of inspector.tags) tagSortOrder.push(tag)
      commitState("add tag")
      // The tag could belong to anything, so we need to flag everything.
      Junction.s = Junction.s
      Port.s = Port.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      amassed.items = amassed.items
   }
   function addEmptyProperty() {
      if (!inspector.mode) return
      newlyAddedProperty = emptyPropertyString
      for (let item of inspector.items) {
         if (item instanceof Crossing) continue
         item.properties.add(newlyAddedProperty)
      }
      propertySortOrder = [newlyAddedProperty] // Put the new property first.
      for (let { property } of inspector.properties)
         propertySortOrder.push(property.serialize())
      commitState("add property")
      // The property could belong to anything, so we need to flag everything.
      Junction.s = Junction.s
      Port.s = Port.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      amassed.items = amassed.items
   }
   function replaceTag(old: Tag, new_: Tag) {
      if (!inspector.mode || old === new_) return
      for (let item of inspector.items) {
         if (item instanceof Crossing) continue
         if (item.tags.has(old)) {
            item.tags.delete(old)
            item.tags.add(new_)
         }
      }
      // Store the current order of the inspector tags, so that when the
      // inspector is refreshed, the tag that was edited is able to retain
      // its position, instead of being sorted lexicographically.
      tagSortOrder = []
      for (let { tag } of inspector.tags) {
         if (tag === old) {
            tagSortOrder.push(new_)
         } else {
            tagSortOrder.push(tag)
         }
      }
      commitState("replace tag")
      // The tag could belong to anything, so we need to flag everything.
      Junction.s = Junction.s
      Port.s = Port.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      amassed.items = amassed.items
   }
   function replacePropertyName(prop: Property, newName: string) {
      if (prop.name !== newName)
         replaceProperty(prop, new Property(newName, prop.value))
   }
   function replacePropertyValue(prop: Property, newValue: string) {
      if (prop.value !== newValue)
         replaceProperty(prop, new Property(prop.name, newValue))
   }
   function replaceProperty(prop: Property, newProp: Property) {
      if (!inspector.mode) return
      let oldPropString = prop.serialize()
      let newPropString = newProp.serialize()
      // Update the properties of the inspected items.
      for (let item of inspector.items) {
         if (item instanceof Crossing) continue
         if (item.properties.has(oldPropString)) {
            item.properties.delete(oldPropString)
            item.properties.add(newPropString)
         }
      }
      // Store the current order of the inspector properties, so that when the
      // inspector is refreshed, the property that was edited is able to retain
      // its position, instead of being sorted lexicographically.
      propertySortOrder = []
      for (let { property } of inspector.properties) {
         if (property === prop) {
            propertySortOrder.push(newPropString)
         } else {
            propertySortOrder.push(property.serialize())
         }
      }
      commitState("replace property")
      // The property could belong to anything, so we need to flag everything.
      Junction.s = Junction.s
      Port.s = Port.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      amassed.items = amassed.items
   }
   function removeTag(tag: Tag) {
      if (!inspector.mode) return
      for (let item of inspector.items) {
         if (item instanceof Crossing) continue
         item.tags.delete(tag)
      }
      commitState("remove tag")
      // The tag could belong to anything, so we need to flag everything.
      Junction.s = Junction.s
      Port.s = Port.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      amassed.items = amassed.items
   }
   function removeProperty(prop: Property) {
      if (!inspector.mode) return
      let propString = prop.serialize()
      for (let item of inspector.items) {
         if (item instanceof Crossing) continue
         item.properties.delete(propString)
      }
      commitState("remove property")
      // The property could belong to anything, so we need to flag everything.
      Junction.s = Junction.s
      Port.s = Port.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      amassed.items = amassed.items
   }
   function narrowAmassmentToTag(tag: Tag) {
      for (let item of amassed.items) {
         if (item instanceof Crossing) continue
         if (!item.tags.has(tag)) amassed.items.delete(item)
      }
      commitState("narrow amassment")
      amassed.items = amassed.items
   }
   function narrowAmassmentToProperty(prop: Property) {
      for (let item of amassed.items) {
         if (item instanceof Crossing) continue
         if (!item.properties.has(prop.serialize())) amassed.items.delete(item)
      }
      commitState("narrow amassment")
      amassed.items = amassed.items
   }
   function amassAllWithTag(tag: Tag) {
      amassed.items.clear()
      for (let item of allThingsWithProperties()) {
         if (item.tags.has(tag)) amassed.items.add(item)
      }
      commitState("amass objects with tag")
      amassed.items = amassed.items
   }
   function amassAllWithProperty(prop: Property) {
      amassed.items.clear()
      for (let item of allThingsWithProperties()) {
         if (item.properties.has(prop.serialize())) amassed.items.add(item)
      }
      commitState("amass objects with property")
      amassed.items = amassed.items
   }
   function propertyFocused() {
      newlyAddedTag = undefined
      newlyAddedProperty = undefined
   }
   let allTags: Set<Tag>
   let allPropertyNames: Set<string>
   let allPropertyValues: Set<string>
   $: {
      allTags = new Set()
      allPropertyNames = new Set()
      allPropertyValues = new Set()
      for (let thing of allThingsWithProperties()) {
         for (let tag of thing.tags) allTags.add(tag)
         for (let prop of thing.properties) {
            let { name, value } = parseProperty(prop)
            allPropertyNames.add(name)
            allPropertyValues.add(value)
         }
      }
   }
   $: specialAttachPointsVisible =
      toolToUse === "draw" &&
      ((!draw && selectedLineType?.name === tetherLineType.name) ||
         (draw && draw.segment.type.name === tetherLineType.name))
   type HighlightStyle = "touch" | "amass" | undefined
   type Section = Geometry.LineSegment<Point>
   type VertexGlyph = {
      type: "vertex glyph"
      vertex: Vertex | SpecialAttachPoint
      glyph: SymbolKind
      position: Point
      rotation: number // in degrees
      style: HighlightStyle
      inheritedColor: string // A vertex may inherit a color from its edges.
   }
   type CrossingGlyph = {
      type: "crossing glyph"
      segment?: Segment
      glyph: SymbolKind
      position: Point
      rotation: number // in degrees
      style: HighlightStyle
      inheritedColor: string // A crossing may inherit a color from its segment.
   }
   type Glyph = VertexGlyph | CrossingGlyph
   let segmentsToDraw: Map<Segment, Section[]>
   let glyphsToDraw: Set<Glyph>
   $: /* Determine which SVG elements (line segments and glyphs) to draw. */ {
      segmentsToDraw = new Map()
      glyphsToDraw = new Set()
      function styleOf(
         thing: Interactable | SpecialAttachPoint
      ): HighlightStyle {
         if (touchLight.has(thing)) return "touch"
         else if (amassLight.has(thing as Interactable)) return "amass"
      }
      let renderedCrossings = new Set<Crossing>()
      for (let segment of Segment.s) {
         // This array will collect the segment endpoints, and all of the
         // points at which crossing glyphs should be spliced into the segment.
         let points: Point[] = [segment.start, segment.end]
         for (let [other, crossing] of crossingMap.read(segment)) {
            // Determine which segment ("segment" or "other") should render a
            // crossing glyph, if any. If "segment" should render, we render it
            // now. If "other" should render, we wait until the iteration of the
            // outer loop when "other" takes on the role of "segment".
            let autoGlyph = segment.type.meeting?.[other.type.name].crossing
            let autoGlyphSymbol = findCrossingGlyph(autoGlyph)
            let cross = segment.crossingKinds.read(other)
            let render: null | {
               glyph: SymbolKind
               facing: "left" | "right"
            } = null
            if (cross.type === "auto" && autoGlyphSymbol) {
               let otherGlyph = other.type.meeting?.[segment.type.name].crossing
               // If both segments have auto-glyphs, then the glyph of the
               // "most horizontal" segment should be shown.
               if (!otherGlyph || isMoreHorizontal(segment, other)) {
                  const facing =
                     segment.start.x < segment.end.x ? "left" : "right"
                  render = { glyph: autoGlyphSymbol, facing }
               }
            } else if (cross.type === "manual") {
               let manualGlyph = cross.glyph
               let glyphSymbol = findCrossingGlyph(manualGlyph)
               if (glyphSymbol) {
                  render = { glyph: glyphSymbol, facing: cross.facing }
               }
            }
            if (render && render.glyph.ports.length === 2) {
               let [p1, p2] = render.glyph.ports
               let glyphDir = p2.directionFrom(p1)
               if (!glyphDir) continue
               let rotation = segment.end
                  .directionFrom(segment.start)
                  ?.rotationFrom(glyphDir)
               if (!rotation) continue
               if (render.facing === "right") {
                  rotation = rotation.add(Rotation.halfTurn)
               }
               let midpoint = p1.interpolatedToward(p2, 0.5)
               let position = crossing.point.displacedBy(
                  Point.zero.displacementFrom(midpoint).rotatedBy(rotation)
               )
               let halfLen = p2.distanceFrom(p1) / 2
               points.push(
                  crossing.point.displacedBy(segment.axis.scaledBy(+halfLen)),
                  crossing.point.displacedBy(segment.axis.scaledBy(-halfLen))
               )
               glyphsToDraw.add({
                  type: "crossing glyph",
                  segment,
                  glyph: render.glyph,
                  position,
                  rotation: rotation.toDegrees(),
                  style: styleOf(crossing) || styleOf(segment),
                  inheritedColor: segment.renderColor(),
               })
               renderedCrossings.add(crossing)
            }
         }
         // Compute the sections of this segment that need to be drawn.
         let distanceOf = (p: Point) => p.sqDistanceFrom(segment.start)
         points.sort((a, b) => distanceOf(a) - distanceOf(b))
         let sections: Section[] = []
         for (let i = 0; i < points.length; i += 2) {
            sections.push(
               new Geometry.LineSegment(points[i], points[i + 1], segment.axis)
            )
         }
         segmentsToDraw.set(segment, sections)
      }
      // Draw a crossing marker at highlighted crossings that have no glyph.
      for (let map of crossingMap.values()) {
         for (let crossing of map.values()) {
            if (
               !renderedCrossings.has(crossing) &&
               (touchLight.has(crossing) || amassLight.has(crossing)) &&
               crossingMarkerGlyph
            ) {
               let port = crossingMarkerGlyph.ports[0]
               glyphsToDraw.add({
                  type: "crossing glyph",
                  glyph: crossingMarkerGlyph,
                  position: crossing.point.displacedBy(
                     new Vector(-port.x, -port.y)
                  ),
                  rotation: 0,
                  style: styleOf(crossing),
                  inheritedColor: "",
               })
            }
         }
      }
      // Determine what vertex glyphs need to be drawn.
      for (let v of allVertices()) {
         // First, determine how/whether the glyph should be rotated.
         let vertexRotation = 0
         if (v.glyphOrientation === "inherit" && v.edges().size > 0) {
            // Consider the edge with the smallest rotation.
            let zero = Direction.positiveX
            let edgeAngles = [...v.edges()].map(
               ([_, vStart]) =>
                  v.directionFrom(vStart)?.rotationFrom(zero).toDegrees() || 0
            )
            vertexRotation = edgeAngles.reduce(
               (min, val) => (Math.abs(val) < Math.abs(min) ? val : min),
               Infinity
            )
         }
         // Now, determine the glyph to draw.
         if (v.glyph.type === "manual") {
            let glyph = findVertexGlyph(v.glyph.glyph)
            if (glyph) {
               glyphsToDraw.add({
                  type: "vertex glyph",
                  vertex: v,
                  glyph,
                  position: v,
                  rotation: vertexRotation,
                  style: styleOf(v),
                  inheritedColor: colorOf(v, false),
               })
            } else if (
               v instanceof Junction &&
               (touchLight.has(v) || amassLight.has(v)) &&
               vertexMarkerGlyph
            ) {
               // Mark the Junction to make it clear that it exists.
               glyphsToDraw.add({
                  type: "vertex glyph",
                  vertex: v,
                  glyph: vertexMarkerGlyph,
                  position: v,
                  rotation: 0,
                  style: styleOf(v),
                  inheritedColor: colorOf(v, false),
               })
            }
         } else if (v instanceof Junction) {
            // Find the appropriate glyph to display at the Junction.
            let glyph: string | undefined
            let edgeTypes = [...v.edges()]
               .map(([segment]) => segment.type)
               .filter((type) => type !== tetherLineType)
            let host = v.host()
            if (host instanceof Segment && host.type !== tetherLineType)
               edgeTypes.push(host.type, host.type)
            if (edgeTypes.length === 1) {
               glyph = edgeTypes[0].ending
            } else if (edgeTypes.length === 2) {
               let glyphA = edgeTypes[0].meeting?.[edgeTypes[1].name].L
               let glyphB = edgeTypes[1].meeting?.[edgeTypes[0].name].L
               if (glyphA === glyphB) {
                  glyph = glyphA
               } else if (!glyphA || !glyphB) {
                  glyph = glyphA || glyphB
               } else {
                  glyph = undefined
               }
            } else if (edgeTypes.length === 3) {
               if (edgeTypes[0].name === edgeTypes[1].name) {
                  glyph = edgeTypes[2].meeting?.[edgeTypes[0].name].T
               } else if (edgeTypes[0].name === edgeTypes[2].name) {
                  glyph = edgeTypes[1].meeting?.[edgeTypes[0].name].T
               } else if (edgeTypes[1].name === edgeTypes[2].name) {
                  glyph = edgeTypes[0].meeting?.[edgeTypes[1].name].T
               } else {
                  // If each edge has a different type, don't show a glyph.
                  glyph = undefined
               }
            } else if (edgeTypes.length >= 4) {
               let names = new Set(edgeTypes.map((t) => t.name))
               if (names.size === 1) {
                  glyph = edgeTypes[0].meeting?.[edgeTypes[0].name].X
               } else if (names.size === 2) {
                  let [nameA, nameB] = [...names]
                  let typeA = edgeTypes.find((t) => t.name == nameA) as LineType
                  let typeB = edgeTypes.find((t) => t.name == nameB) as LineType
                  let glyphA = typeA.meeting?.[typeB.name].X
                  let glyphB = typeB.meeting?.[typeA.name].X
                  if (glyphA === glyphB) {
                     glyph = glyphA
                  } else if (!glyphA || !glyphB) {
                     glyph = glyphA || glyphB
                  } else {
                     glyph = undefined
                  }
               } else if (names.size === 3 && edgeTypes.length === 4) {
                  let glyphA, glyphB
                  if (edgeTypes[0].name === edgeTypes[1].name) {
                     glyphA = edgeTypes[2].meeting?.[edgeTypes[0].name].T
                     glyphB = edgeTypes[3].meeting?.[edgeTypes[0].name].T
                  } else if (edgeTypes[0].name === edgeTypes[2].name) {
                     glyphA = edgeTypes[1].meeting?.[edgeTypes[0].name].T
                     glyphB = edgeTypes[3].meeting?.[edgeTypes[0].name].T
                  } else if (edgeTypes[0].name === edgeTypes[3].name) {
                     glyphA = edgeTypes[1].meeting?.[edgeTypes[0].name].T
                     glyphB = edgeTypes[2].meeting?.[edgeTypes[0].name].T
                  } else if (edgeTypes[1].name === edgeTypes[2].name) {
                     glyphA = edgeTypes[0].meeting?.[edgeTypes[1].name].T
                     glyphB = edgeTypes[3].meeting?.[edgeTypes[1].name].T
                  } else if (edgeTypes[1].name === edgeTypes[3].name) {
                     glyphA = edgeTypes[0].meeting?.[edgeTypes[1].name].T
                     glyphB = edgeTypes[2].meeting?.[edgeTypes[1].name].T
                  } else {
                     glyphA = edgeTypes[0].meeting?.[edgeTypes[2].name].T
                     glyphB = edgeTypes[1].meeting?.[edgeTypes[2].name].T
                  }
                  if (glyphA === glyphB) {
                     glyph = glyphA
                  } else if (!glyphA || !glyphB) {
                     glyph = glyphA || glyphB
                  } else {
                     glyph = undefined
                  }
               } else {
                  glyph = undefined
               }
            }
            let glyphSymbol = findVertexGlyph(glyph)
            if (glyph && glyphSymbol) {
               glyphsToDraw.add({
                  type: "vertex glyph",
                  vertex: v,
                  glyph: glyphSymbol,
                  position: v,
                  rotation: vertexRotation,
                  style: styleOf(v),
                  inheritedColor: colorOf(v, false),
               })
            } else if (
               vertexMarkerGlyph &&
               (touchLight.has(v) ||
                  amassLight.has(v) ||
                  // If the edges form a straight line
                  (edgeTypes.length === 2 &&
                     edgeTypes[0].name === edgeTypes[1].name &&
                     v.axes().length === 1 &&
                     !v.host()))
            ) {
               // Mark the Junction to make it clear that it exists.
               glyphsToDraw.add({
                  type: "vertex glyph",
                  vertex: v,
                  glyph: vertexMarkerGlyph,
                  position: v,
                  rotation: 0,
                  style: styleOf(v),
                  inheritedColor: colorOf(v, false),
               })
            }
         } else if (
            v instanceof Port &&
            (touchLight.has(v) || amassLight.has(v)) &&
            vertexMarkerGlyph
         ) {
            // Highlight ports on hover.
            glyphsToDraw.add({
               type: "vertex glyph",
               vertex: v,
               glyph: vertexMarkerGlyph,
               position: v,
               rotation: 0,
               style: styleOf(v),
               inheritedColor: colorOf(v, false),
            })
         }
      }
      if (attachMarkerGlyph) {
         for (let p of specialAttachPoints()) {
            if (
               specialAttachPointsVisible ||
               (p.object instanceof Segment &&
                  p.object.attachments.size > 0 &&
                  config.showTethers.state === "on")
            )
               glyphsToDraw.add({
                  type: "vertex glyph",
                  vertex: p,
                  glyph: attachMarkerGlyph,
                  position: p,
                  rotation: 0,
                  style: styleOf(p),
                  inheritedColor: "",
               })
         }
      }
   }
   let attachmentErrors: Set<{ source: Point; target: Point }> // for debugging
   $: {
      attachmentErrors = new Set()
      for (let object of [...Segment.s, ...SymbolInstance.s]) {
         for (let attachment of object.attachments) {
            let target = object.partClosestTo(attachment)
            if (attachment.sqDistanceFrom(target) > sqErr) {
               attachmentErrors.add({ source: attachment, target })
               console.error(
                  "An attachment has become separated from its host." +
                     " (A red error line has been rendered.)"
               )
            }
         }
      }
   }
   let rigidlyMovedSegments: Set<Segment>
   $: {
      rigidlyMovedSegments = new Set()
      if (slide) {
         for (let segment of Segment.s) {
            if (!slide.rigidSegments.has(segment)) continue
            let [s, e] = [movableAt(segment.start), movableAt(segment.end)]
            if (
               s.sqDistanceFrom(slide.originalPositions.read(s)) > 0 ||
               e.sqDistanceFrom(slide.originalPositions.read(e)) > 0 ||
               slide.immediatelyMoved.has(segment)
            ) {
               rigidlyMovedSegments.add(segment)
            }
         }
      } else if (warp) {
         rigidlyMovedSegments = warp.rigidSegments
      }
   }
   let amassedCopyables = new Set<Segment | SymbolInstance>()
   $: {
      amassedCopyables = new Set()
      for (let item of amassed.items) {
         if (item instanceof Segment || item instanceof SymbolInstance)
            amassedCopyables.add(item)
      }
   }

   // ---------------------------- Primary events -----------------------------
   let amassedOnMouseDown = false
   let erasedOnMouseDown = false
   let frozeOnMouseDown: false | "freeze" | "unfreeze" = false
   function keyPressed(name: string) {
      let key = keyInfo.getOrCreate(name)
      if (key.pressing) return // in case we missed a release
      key.pressing = true
      amassedOnMouseDown = false
      erasedOnMouseDown = false
      frozeOnMouseDown = false
      // Update the state of double-tap actions.
      if (
         name === "Space" &&
         spacebarTap.state === "tapped" &&
         spacebarTapIsFresh()
      ) {
         resetCamera()
         spacebarTap = { state: "initial" }
      } else {
         spacebarTap = {
            state: "pressed",
            timeOfAction: now(),
            placeOfAction: mouseInClient,
         }
      }
      // Perform the action associated with the key.
      if (key.type === "pan" && !pan) {
         pan = { clientDownPosition: mouseInClient }
      } else if (key.type === "delete" && amassed.items.size > 0) {
         deleteItems(amassed.items)
         amassed.items = amassed.items // Let Svelte know the group has changed.
         commitState("erase amassed")
      } else if (key.type === "holdTool") {
         if (
            toolBeingUsed?.tool === "draw" &&
            (key.tool === "draw" || key.tool === "freeze")
         ) {
            // Pressing draw/freeze initiates a chain draw.
            chainDraw(key.tool === "freeze")
            commitState("draw segment")
         } else {
            // Hold the tool. If another tool is already held, it is overridden.
            heldTool = { tool: key.tool, shouldBind: true }
         }
      } else if (key.type === "useTool") {
         toolBeingUsed = { tool: toolToUse, canvasDownPosition: mouseOnCanvas }
         if (heldTool) {
            heldTool.shouldBind = false // The tool is being used temporarily.
         }
         // Actions to perform immediately:
         if (toolToUse === "amass") {
            let target = amassTarget(mouseOnCanvas)
            let shift = keyInfo.read(Shift).pressing
            let alt = keyInfo.read(Alt).pressing
            if (target) {
               if (shift) {
                  if (amassed.items.has(target.object)) {
                     amassed.items.delete(target.object)
                  } else {
                     amassed.items.add(target.object)
                     if (target.object instanceof Segment) {
                        // The segment's crossings should be unselected.
                        for (let [_, cross] of crossingMap.read(target.object))
                           amassed.items.delete(cross)
                     } else if (target.object instanceof Crossing) {
                        // The crossing's segments should be unselected.
                        amassed.items.delete(target.object.seg1)
                        amassed.items.delete(target.object.seg2)
                     }
                  }
               } else if (alt) amassed.items.delete(target.object)
               else amassed.items = new Set([target.object])
               amassed.items = amassed.items
               amassedOnMouseDown = true
               doNotLightUp = {
                  item: target.object,
                  clientPosition: mouseInClient,
               }
            } else if (amassed.items.size > 0 && !shift && !alt) {
               amassed.items = new Set()
               amassedOnMouseDown = true
            }
         } else if (toolToUse === "erase") {
            let target = eraseTarget(mouseOnCanvas)
            if (target) {
               if (amassed.items.has(target.object)) {
                  deleteItems(amassed.items)
               } else {
                  deleteItems([target.object])
               }
               erasedOnMouseDown = true
            }
         } else if (toolToUse === "freeze") {
            let target = freezeTarget(mouseOnCanvas)
            if (target) {
               target.object.isFrozen = !target.object.isFrozen
               frozeOnMouseDown = target.object.isFrozen ? "freeze" : "unfreeze"
               Segment.s = Segment.s
            }
         }
      } else if (key.type === "abort") {
         keyAborted(LMB)
      }
      // Check if a line type shortcut key has been pressed.
      if (lineTypeConfig) {
         let shortcutPressed = name
         for (let prefix of ["Key", "Digit", "Numpad"])
            if (name.startsWith(prefix))
               shortcutPressed = name.slice(prefix.length)
         for (let [lineTypeName, shortcutName] of Object.entries(
            lineTypeConfig.keyBindings
         )) {
            // Normalize the name, in case it is an integer or the wrong case.
            shortcutName = shortcutName.toString().toLowerCase()
            // Check if this is the shortcut being pressed.
            if (shortcutName === shortcutPressed.toLowerCase()) {
               for (let type of lineTypes)
                  if (type.name === lineTypeName) {
                     selectedLineType = type
                     boundTool = "draw"
                  }
               break
            }
         }
      }
      keyInfo = keyInfo
   }
   function command(
      name: string,
      repeat: boolean = false
   ): "recognized" | "not recognized" {
      // Unlike for a standard key press, we don't update the state of the key.
      if (name === "KeyZ") {
         keyInfo.read(Shift).pressing ? executeRedo() : executeUndo()
         return "recognized"
      } else if (name === "KeyX") {
         cut(amassedCopyables)
         commitState("cut")
         Junction.s = Junction.s
         Segment.s = Segment.s
         SymbolInstance.s = SymbolInstance.s
         Port.s = Port.s
         amassed.items = amassed.items
         return "recognized"
      } else if (name === "KeyC") {
         copy(amassedCopyables)
         return "recognized"
      } else if (name === "KeyV" || name === "KeyD") {
         let didPaste = name === "KeyV"
         let items = didPaste ? paste() : duplicate(amassedCopyables)
         // Gather all of the Movables that were pasted.
         let thingsToMove = new Set<Movable>()
         for (let item of items) {
            if (item instanceof Segment) {
               if (item.start instanceof Junction) thingsToMove.add(item.start)
               if (item.end instanceof Junction) thingsToMove.add(item.end)
            } else {
               thingsToMove.add(item)
            }
         }
         // Find their centroid.
         let v = zeroVector
         for (let m of thingsToMove) {
            let p = m instanceof SymbolInstance ? m.center() : m
            v = v.add(p.displacementFrom(Point.zero))
         }
         let centroid = Point.zero.displacedBy(
            v.scaledBy(1 / thingsToMove.size)
         )
         // Place the centroid at the mouse position — with an offset for
         // repeated pasting.
         let d = mouseOnCanvas.displacementFrom(centroid).add(pasteOffset)
         for (let thing of thingsToMove) thing.moveBy(d)
         pasteOffset = pasteOffset.add(new Vector(20, 20))
         // Amass the copied items.
         amassed.items = new Set(items)

         commitState(didPaste ? "paste" : "duplicate")
         Junction.s = Junction.s
         Segment.s = Segment.s
         SymbolInstance.s = SymbolInstance.s
         Port.s = Port.s
         return "recognized"
      } else if (name === "KeyA") {
         if (!repeat) {
            // Select everything in the circuit.
            amassed.items = new Set()
            for (let segment of Segment.s) amassed.items.add(segment)
            for (let symbol of SymbolInstance.s) amassed.items.add(symbol)
            commitState("amass all")
         }
         return "recognized"
      } else {
         return "not recognized"
      }
   }
   function keyReleased(name: string) {
      let key = keyInfo.getOrCreate(name)
      if (!key.pressing) return // in case we missed a press
      key.pressing = false
      // Update the state of double-tap actions.
      if (
         name === "Space" &&
         spacebarTap.state === "pressed" &&
         spacebarTapIsFresh()
      ) {
         spacebarTap = {
            state: "tapped",
            timeOfAction: now(),
            placeOfAction: mouseInClient,
         }
      } else {
         spacebarTap = { state: "initial" }
      }
      // Perform the action associated with the key.
      if (key.type === "pan") {
         endPan()
      } else if (key.type === "holdTool") {
         if (heldTool?.tool === key.tool) {
            if (heldTool.shouldBind) boundTool = heldTool.tool
            heldTool = null
         }
      } else if (key.type === "useTool" && toolBeingUsed) {
         switch (toolBeingUsed.tool) {
            case "amass": {
               let workWasDone =
                  amassedOnMouseDown || (amassRect && amassRect.items.size > 0)
               endAmassRect()
               if (workWasDone) commitState("amass")
               break
            }
            case "warp":
               if (warp) {
                  endWarp()
                  commitState("warp")
                  grabbedSymbol = null
               }
               break
            case "slide":
               if (slide) {
                  endSlide()
                  commitState("slide")
               }
               break
            case "draw": {
               if (draw) {
                  endDraw()
                  commitState("draw segment")
               } else if (!toolBeingUsed.chainDrawFromEnd) {
                  //drawButtonTapped()
               }
               break
            }
            case "erase": {
               let workWasDone =
                  erasedOnMouseDown || (eraseRect && eraseRect.items.size > 0)
               endEraseRect()
               if (workWasDone) commitState("erase")
               break
            }
            case "freeze":
               if (freezeRect && freezeRect.items.size > 0) {
                  let message =
                     freezeRect.mode === "add"
                        ? "freeze region"
                        : "unfreeze region"
                  endFreezeRect()
                  commitState(message)
               } else if (frozeOnMouseDown) {
                  commitState(frozeOnMouseDown)
               }
               endFreezeRect()
               break
         }
         toolBeingUsed = null
      }
      keyInfo = keyInfo
   }
   function keyAborted(name: string) {
      let key = keyInfo.getOrCreate(name)
      if (!key.pressing) return // in case we missed a press
      key.pressing = false
      if (key.type === "pan") {
         endPan() // Don't revert this, just end it.
      } else if (key.type === "holdTool") {
         if (heldTool?.tool === key.tool) heldTool = null
      } else if (key.type === "useTool" && toolBeingUsed) {
         // Revert uncommitted state changes.
         loadState(history.stack[history.index].state)
      }
      keyInfo = keyInfo
   }
   function updateModifierKeys(event: KeyboardEvent | MouseEvent) {
      keyInfo.getOrCreate(Shift).pressing = event.getModifierState(Shift)
      keyInfo.getOrCreate(Alt).pressing = event.getModifierState(Alt)
      keyInfo.getOrCreate(Control).pressing =
         event.getModifierState(Control) || event.getModifierState("Meta")
      if (
         (draw && draw.mode !== selectedDrawMode()) ||
         (slide && slide.mode !== selectedSlideMode())
      )
         updateDrawAndSlide()
      if (warp && warp.mode !== selectedWarpMode()) updateWarp()
   }
   let waitedOneFrameLMB = false
   let waitedOneFrameMMB = false
   let waitedOneFrameRMB = false
   function leftMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b001) !== 0
   }
   function middleMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b100) !== 0
   }
   function rightMouseIsDown(event: MouseEvent) {
      return (event.buttons & 0b010) !== 0
   }
   function mouseMoved() {
      cameraPosition = computeCameraPosition()
      mouseOnCanvas = computeMouseOnCanvas() // hack: immediately update the var
      pasteOffset = new Vector(0, 0)
      // Update the actions that depend on mouse movement. (It's important that
      // these updates are invoked BEFORE any begin___() functions. The begin___
      // funcs may induce changes to derived data that the updates need to see.)
      updateDrawAndSlide()
      updateWarp()
      updateAmassRect()
      updateEraseRect()
      updateFreezeRect()
      // Update highlighting.
      if (
         doNotLightUp.item !== null &&
         mouseInClient.sqDistanceFrom(doNotLightUp.clientPosition) >=
            sqLightUpDistance
      ) {
         doNotLightUp = { item: null }
      }
      // Check for the initiation of drag-based operations.
      if (toolBeingUsed) {
         let dragVector = mouseOnCanvas
            .displacementFrom(toolBeingUsed.canvasDownPosition)
            .scaledBy(cameraZoom)
         let shortDrag = dragVector.sqLength() >= sqShortDragDelay
         let longDrag = dragVector.sqLength() >= sqLongDragDelay
         let { tool } = toolBeingUsed
         if (tool === "draw" && !draw && longDrag) {
            beginDraw(dragVector)
         } else if (tool === "warp" && !warp && shortDrag) {
            let target = warpTarget(toolBeingUsed.canvasDownPosition)
            if (target) beginWarp(target.object, target.closestPart)
         } else if (tool === "slide" && !slide && longDrag) {
            let dragAxis = Axis.fromVector(dragVector)
            let target = slideTarget(toolBeingUsed.canvasDownPosition)
            if (dragAxis && target) {
               let slideAxis: Axis
               if (target.object instanceof Segment) {
                  let axes = new Set([
                     ...target.object.start.axes(),
                     ...target.object.end.axes(),
                  ])
                  if (axes.size === 1) axes.add(target.object.axis.orthogonal())
                  slideAxis = nearestAxis(dragAxis, [...axes])
               } else {
                  let axes = target.object.axes()
                  if (axes.length === 0) axes = primaryAxes
                  else if (axes.length === 1) axes.push(axes[0].orthogonal())
                  slideAxis = nearestAxis(dragAxis, axes)
               }
               beginSlide(slideAxis, target.object, target.closestPart)
            }
         } else if (tool === "amass" && !amassRect && shortDrag) {
            beginAmassRect(toolBeingUsed.canvasDownPosition)
         } else if (tool === "erase" && !eraseRect && shortDrag) {
            beginEraseRect(toolBeingUsed.canvasDownPosition)
         } else if (tool === "freeze" && !freezeRect && shortDrag) {
            beginFreezeRect(toolBeingUsed.canvasDownPosition)
         }
      }
   }
   function spawnSymbol(kind: SymbolKind, grabOffset: Vector) {
      // Spawn a symbol on the canvas, and initiate a move action.
      let spawnPosition = mouseOnCanvas.displacedBy(
         grabOffset.scaledBy(1 / cameraZoom)
      )
      let symbol = new SymbolInstance(kind, spawnPosition)
      toolBeingUsed = { tool: "warp", canvasDownPosition: mouseOnCanvas }
      beginWarp(symbol, mouseOnCanvas)
   }
   function executeZoom(magnitude: number) {
      let newZoom = cameraZoom * 2 ** magnitude
      newZoom = Math.max(minZoom, Math.min(newZoom, maxZoom))
      let zoomFactor = newZoom / cameraZoom
      // Zoom towards the mouse position.
      cameraZoom = newZoom
      committedCameraPosition = committedCameraPosition.displacedBy(
         mouseOnCanvas
            .displacementFrom(cameraPosition)
            .scaledBy((zoomFactor - 1) / zoomFactor)
      )
   }
   function resetCamera() {
      // Move the camera to the center of the circuit.
      committedCameraPosition = Point.median(
         [...allMovables()].map((m) => m.center())
      )
      // Make the zoom level something reasonable.
      cameraZoom = 0.3
   }

   // ---------------------------- Derived events -----------------------------
   function endPan() {
      committedCameraPosition = cameraPosition
      pan = null
   }
   function beginDraw(dragVector: Vector) {
      if (!toolBeingUsed || !lineTypeToUse) return
      let drawMode = selectedDrawMode()
      if (toolBeingUsed.chainDrawFromEnd) {
         // Start the draw operation at the endpoint of the previous
         // draw operation.
         let end = toolBeingUsed.chainDrawFromEnd
         toolBeingUsed.chainDrawFromEnd = undefined
         // Avoid drawing along undesirable axes.
         let avoidDrawAxes = new Set<Axis>()
         if (end.axes().length === 1) {
            avoidDrawAxes.add(end.axes()[0])
         } else {
            // Avoid axes that are "full" (i.e. two segments occupy them).
            let axes = new Set<Axis>()
            for (let [seg] of end.edges()) {
               if (axes.has(seg.axis)) {
                  avoidDrawAxes.add(seg.axis)
               } else {
                  axes.add(seg.axis)
               }
            }
         }
         // Determine the axis the draw operation should begin along.
         let drawAxis = Axis.fromVector(dragVector) as Axis
         if (drawMode === "strafing") {
            drawAxis = nearestAxis(
               drawAxis,
               primaryAxes.filter((axis) => !avoidDrawAxes.has(axis))
            )
         } else if (drawMode === "snapped rotation") {
            drawAxis = nearestAxis(
               drawAxis,
               snapAxes.filter((axis) => !avoidDrawAxes.has(axis))
            )
         }
         newDraw(lineTypeToUse, end, drawAxis)
         return
      }
      // Otherwise, start the draw operation at the closest attachable.
      let attach = drawTarget(toolBeingUsed.canvasDownPosition)
      // First, determine the axis the draw operation should begin along.
      let dragAxis = Axis.fromVector(dragVector) as Axis
      let regularDrawAxis, specialDrawAxis
      if (drawMode === "free rotation") {
         regularDrawAxis = specialDrawAxis = dragAxis
      } else {
         let regularAxes = drawMode === "strafing" ? primaryAxes : snapAxes
         let extraAxesToConsider =
            attach?.object instanceof Segment
               ? [attach.object.axis] // The axis of the segment.
               : attach && isVertex(attach?.object)
               ? [...attach.object.axes()] // The axes incident to the vertex.
               : []
         regularDrawAxis = nearestAxis(dragAxis, regularAxes)
         specialDrawAxis = nearestAxis(dragAxis, [
            ...regularAxes,
            ...extraAxesToConsider,
         ])
      }
      if (attach?.object instanceof Segment) {
         let segment = attach.object
         if (specialDrawAxis == segment.axis && segment.attachments.size == 0) {
            // Cut the segment, and allow the user to move one side of it.
            let direction = segment.start.displacementFrom(attach.closestPart)
            let [newStart, otherV] =
               direction.dot(dragVector) > 0
                  ? [segment.start, segment.end]
                  : [segment.end, segment.start]
            let jMove = new Junction(attach.closestPart)
            let jOther = new Junction(attach.closestPart)
            let move = segment.sliceOut(newStart, jMove)
            let other = segment.sliceOut(otherV, jOther)
            segment.delete()
            continueDraw(move, jMove)
         } else {
            let junction = new Junction(attach.closestPart)
            let meeting = lineTypeToUse.meeting?.[segment.type.name]
            if (lineTypeToUse.attachToAll || meeting?.attaches) {
               junction.attachTo(segment) // attach to target (don't split)
            } else {
               segment.splitAt(junction) // split target, making a T-junction
            }
            newDraw(lineTypeToUse, junction, regularDrawAxis)
         }
      } else if (attach && isVertex(attach.object)) {
         let vertex = attach.object
         let continuedDraw = false
         if (
            vertex instanceof Junction &&
            vertex.edges().size === 1 &&
            [...vertex.edges()][0][0].attachments.size === 0 &&
            !vertex.host() &&
            vertex.axes()[0] === specialDrawAxis
         ) {
            // Extend the segment.
            continueDraw([...vertex.edges()][0][0], vertex)
            continuedDraw = true
         } else {
            for (let [segment, other] of vertex.edges()) {
               if (segment.axis !== specialDrawAxis) continue
               if (segment.attachments.size > 0) continue
               if (other.displacementFrom(vertex).dot(dragVector) <= 0) continue
               // Unplug this segment from the vertex.
               let junction = new Junction(vertex)
               let newSegment = segment.sliceOut(other, junction)
               segment.delete()
               if (
                  vertex instanceof Junction &&
                  vertex.edges().size === 2 &&
                  !vertex.host()
               ) {
                  vertex.fuse()
               }
               // Allow the user to move the unplugged segment around.
               continueDraw(newSegment, junction)
               continuedDraw = true
               break
            }
         }
         if (!continuedDraw) newDraw(lineTypeToUse, vertex, regularDrawAxis)
      } else if (attach?.object instanceof SpecialAttachPoint) {
         let attachPoint = attach.object
         // Begin drawing from the attachment point.
         let junction = new Junction(attachPoint)
         junction.attachTo(attachPoint.object)
         newDraw(lineTypeToUse, junction, regularDrawAxis)
      } else {
         newDraw(
            lineTypeToUse,
            new Junction(toolBeingUsed.canvasDownPosition),
            regularDrawAxis
         )
      }
      Segment.s = Segment.s
   }
   function newDraw(type: LineType, start: Vertex, axis: Axis) {
      let mode: DrawMode = selectedDrawMode()
      let end = new Junction(start)
      let color = colorOf(start, true)
      let segment = new Segment(type, start, end, axis)
      segment.color = color
      draw = {
         mode,
         segment,
         end,
         segmentIsNew: true,
      }
      if (mode === "strafing") beginDrawStrafing()
      if (segment.isTether() && config.showTethers.state === "off")
         config.showTethers.state = "on"
      selectedLineType = segment.type
   }
   function continueDraw(drawSegment: Segment, end: Junction) {
      let mode: DrawMode = selectedDrawMode()
      let segment
      if (end === drawSegment.end) {
         segment = drawSegment
      } else {
         // Flip the segment around.
         segment = drawSegment.sliceOut(drawSegment.end, end)
         drawSegment.delete()
      }
      // Ensure the segment being drawn is not amassed.
      amassed.items.delete(segment)
      // This function should never be called on a segment with attachments,
      // but if it is, remove the attachments. (There's no good alternative.)
      segment.attachments.forEach((a) => a.detach())
      // Initialize the draw operation.
      draw = {
         mode,
         segment,
         end,
         segmentIsNew: false,
      }
      if (mode === "strafing") beginDrawStrafing()
      if (segment.isTether() && config.showTethers.state === "off")
         config.showTethers.state = "on"
      selectedLineType = segment.type
   }
   function beginDrawStrafing() {
      if (!draw) return
      let drawAxis = draw.segment.axis
      let orthoAxis = drawAxis.orthogonal()
      // Pre-compute the information required for snapping.
      if (config.distanceSnap.state === "off") {
         draw.drawAxisRanges = undefined
         draw.orthoRanges = undefined
      } else {
         draw.drawAxisRanges = projectionOfCircuitOnto(
            drawAxis,
            config.distanceSnap.state
         )
         draw.orthoRanges = projectionOfCircuitOnto(
            orthoAxis,
            config.distanceSnap.state
         )
      }
      // Initialize sliding.
      let thingToMove = movableAt(draw.segment.start)
      let axes = thingToMove.axes()
      let slideAxis
      if (axes.length === 1 && axes[0] !== drawAxis) {
         slideAxis = axes[0]
      } else if (axes.length === 2 && axes.includes(drawAxis)) {
         slideAxis = axes[0] === drawAxis ? axes[1] : axes[0]
      } else {
         slideAxis = orthoAxis
      }
      if (Math.abs(slideAxis.scalarRejectionFrom(drawAxis)) < 0.1) {
         slideAxis = orthoAxis // reject very acute angles
      }
      beginSlide(slideAxis, thingToMove, draw.segment.start)
   }
   function endDraw(willChainDraw: boolean = false): Vertex | undefined {
      if (!draw) return
      endSlide()
      let segment = draw.segment
      let endObject = draw.endObject
      function isAcceptable() {
         for (let [s, other] of segment.start.edges()) {
            if (
               s !== segment &&
               s.axis === segment.axis &&
               other.distanceFrom(segment.end) + err <
                  segment.start.distanceFrom(segment.end) +
                     other.distanceFrom(segment.start)
            )
               return false
         }
         if (
            segment.start instanceof Junction &&
            segment.start.host() instanceof Segment &&
            (segment.start.host() as Segment).axis === segment.axis
         )
            return false
         return true
      }
      let endVertex: Vertex | undefined
      if (segment.sqLength() >= sqMinSegmentLength && isAcceptable()) {
         if (endObject instanceof Segment) {
            let meeting = segment.type.meeting?.[endObject.type.name]
            if (segment.type.attachToAll || meeting?.attaches) {
               draw.end.attachTo(endObject) // attach to target (don't split)
            } else {
               endObject.splitAt(draw.end) // split target, making a T-junction
            }
            endVertex = draw.end
         } else if (endObject) {
            if (isVertex(endObject)) {
               endVertex = endObject
            } else {
               endVertex = new Junction(endObject)
               endVertex.attachTo(endObject.object)
            }
            // Replace the drawn segment with one that ends at the endVertex.
            segment.sliceOut(segment.start, endVertex)
            segment.delete()
            if (endVertex.edges().size === 2 && !willChainDraw) {
               // Try fusing the drawn segment with the other segment at the
               // vertex.
               ;(endVertex as Junction).fuse()
            }
         } else {
            endVertex = draw.end
         }
      } else if (willChainDraw) {
         endVertex = draw.end
      } else {
         deleteItems([draw.end])
      }
      draw = null
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
      amassed.items = amassed.items

      return endVertex
   }
   function chainDraw(freezeCurrent: boolean) {
      if (!draw || !toolBeingUsed) return
      draw.segment.isFrozen = freezeCurrent
      // Start a new draw operation at the current draw endpoint.
      toolBeingUsed.canvasDownPosition = mouseOnCanvas
      toolBeingUsed.chainDrawFromEnd = endDraw(true)
   }
   function beginSlide(slideAxis: Axis, grabbed: Grabbable, atPart: Point) {
      function generateInstructions(
         slideDir: Direction,
         shouldPushNonConnected: boolean
      ): [SlideInstruction[], Map<Segment, number>] {
         // The final instruction sequence.
         let instructions: SlideInstruction[] = []
         // Record segments whose movement is affected because they are frozen.
         let rigidSegments = new Map<Segment, number>()
         let haveScheduledAmassed = false
         let orthogonalAxis = slideAxis.orthogonal()
         let slideRanges = projectionOfCircuitOnto(slideDir)
         let orthoRanges = projectionOfCircuitOnto(orthogonalAxis, slidePad / 2)
         if (draw) {
            // The segment being drawn should be invisible to the slide op.
            slideRanges.delete(draw.end)
            orthoRanges.delete(draw.end)
            slideRanges.delete(draw.segment)
            orthoRanges.delete(draw.segment)
         }

         // ------------------ PART 1: Initialize the heap. -------------------
         // Instructions need to be scheduled in order of priority. Thus, as
         // instructions are proposed, we insert them into a heap.
         let heap = new Heap<SlideInstruction>((a, b) => a.delay - b.delay)
         // Proposals are also stored in a Map, so that we can update them.
         let proposals = new Map<Movable, SlideInstruction>()
         // Add the initial proposals to the heap.
         if (grabbed instanceof Segment) {
            let startMovable = movableAt(grabbed.start)
            let endMovable = movableAt(grabbed.end)
            let i1 = { movable: startMovable, delay: 0, isPush: false }
            let i2 = { movable: endMovable, delay: 0, isPush: false }
            heap.push(i1)
            heap.push(i2)
            proposals.set(startMovable, i1)
            proposals.set(endMovable, i2)
         } else {
            let i = { movable: grabbed, delay: 0, isPush: false }
            heap.push(i)
            proposals.set(grabbed, i)
         }

         // --------------- PART 2: Generate the instructions. ----------------
         while (heap.size() > 0) {
            let nextInstruction = heap.pop() as SlideInstruction
            let { movable, delay, isPush } = nextInstruction
            instructions.push(nextInstruction) // Finalize this instruction.

            function pushNonConnected(pusher: Pushable) {
               if (config.distanceSnap.state === "off") return
               if (!slideRanges.has(pusher)) return
               let pusherSlide = slideRanges.get(pusher) as Range1D
               let pusherOrthogonal = orthoRanges.get(pusher) as Range1D
               for (let [target, targetOrthogonal] of orthoRanges) {
                  if (
                     pusher instanceof Junction &&
                     target instanceof Junction &&
                     [...target.edges()].every(([s]) => s.axis !== slideAxis)
                  )
                     continue // This interaction doesn't make much sense.
                  if (target instanceof Segment && target.axis === slideAxis) {
                     // To allow a segment parallel to the slideAxis to be
                     // squished, we should push the endpoints, not the segment.
                     continue
                  }
                  if (!pusherOrthogonal.intersects(targetOrthogonal)) continue
                  let targetSlide = slideRanges.get(target) as Range1D
                  let disp = targetSlide.displacementFrom(pusherSlide)
                  if (disp <= 0) continue
                  let distance = Math.max(0, disp - config.distanceSnap.state)
                  if (target instanceof Segment) {
                     proposeTo(movableAt(target.start), delay + distance, true)
                     proposeTo(movableAt(target.end), delay + distance, true)
                  } else {
                     proposeTo(target, delay + distance, true)
                  }
               }
            }
            if (shouldPushNonConnected) {
               pushNonConnected(movable) // Movable pushes things in its path.
            }
            // Propagate the movement along the Movable's edges.
            for (let [segment, adjVertex] of movable.edges()) {
               if (segment === draw?.segment) continue // handled elsewhere
               if (segment.axis === orthogonalAxis && shouldPushNonConnected) {
                  pushNonConnected(segment) // Orthogonal segments push things!
               }
               // ---------- Logic for pushing connected Movables. ------------
               let nearVertex =
                  adjVertex === segment.end ? segment.start : segment.end
               let adjDir = adjVertex.directionFrom(nearVertex)
               if (!adjDir) continue
               let canStretch = segment.axis === slideAxis && !segment.isRigid()
               let rigidityMatters =
                  segment.axis === slideAxis && segment.isRigid()
               if (
                  canStretch &&
                  adjDir.approxEquals(slideDir, err) &&
                  config.distanceSnap.state !== "off"
               ) {
                  // Allow the edge to contract toward a minimum length.
                  let length = segment.length()
                  let d = Math.max(0, length - config.distanceSnap.state)
                  proposeTo(movableAt(adjVertex), delay + d, true)
                  // Push attachments as the endpoint approaches them.
                  for (let attachment of segment.attachments) {
                     let distance = attachment.distanceFrom(nearVertex)
                     let e = Math.max(0, distance - config.distanceSnap.state)
                     proposeTo(attachment, delay + e, true)
                  }
               } else if (canStretch) {
                  // The segment can stretch indefinitely.
                  continue
               } else {
                  // Push the endpoint and attachments immediately.
                  proposeTo(movableAt(adjVertex), delay, isPush)
                  for (let attachment of segment.attachments)
                     proposeTo(attachment, delay, isPush)
                  if (rigidityMatters) rigidSegments.set(segment, delay)
               }
            }
            if (movable instanceof SymbolInstance) {
               // Attachments must move with their host.
               for (let a of movable.attachments) proposeTo(a, delay, isPush)
            } else if (movable instanceof Junction) {
               // Hosts must move with their attachments.
               let host = movable.host()
               if (host instanceof SymbolInstance) {
                  proposeTo(host, delay, isPush)
               } else if (host instanceof Segment) {
                  let canStretch = host.axis === slideAxis && !host.isRigid()
                  let rigidityMatters = host.axis == slideAxis && host.isRigid()
                  if (canStretch) {
                     // Prevent the attachment from sliding past the endpoint.
                     let hostDir = host.end.directionFrom(movable)
                     let endpoint = hostDir?.approxEquals(slideDir, err)
                        ? host.end
                        : host.start
                     let distance = endpoint.distanceFrom(movable)
                     let distanceSnap =
                        config.distanceSnap.state === "off"
                           ? slidePad // don't let attachment overlap endpoint
                           : config.distanceSnap.state
                     let e = Math.max(0, distance - distanceSnap)
                     proposeTo(movableAt(endpoint), delay + e, true)
                  } else {
                     // Push the host immediately.
                     proposeTo(movableAt(host.start), delay, isPush)
                     proposeTo(movableAt(host.end), delay, isPush)
                     if (rigidityMatters) rigidSegments.set(host, delay)
                  }
               }
            }
            // Check whether amassed items should be moved at the same time as
            // this Movable. Amassed items move rigidly together.
            if (
               !haveScheduledAmassed &&
               (amassed.items.has(movable) ||
                  [...movable.edges()].some((edge) =>
                     amassed.items.has(edge[0])
                  ))
            ) {
               for (let item of amassed.items) {
                  if (item === draw?.end) continue // this is moved elsewhere
                  if (item instanceof Port || item instanceof Crossing) continue
                  if (item instanceof Segment) {
                     if (item.start !== draw?.end)
                        proposeTo(movableAt(item.start), delay, isPush)
                     if (item.end !== draw?.end)
                        proposeTo(movableAt(item.end), delay, isPush)
                  } else {
                     proposeTo(item, delay, isPush)
                  }
               }
               haveScheduledAmassed = true
            }
         }
         function proposeTo(movable: Movable, delay: number, isPush: boolean) {
            let existingProposal = proposals.get(movable)
            if (existingProposal) {
               if (existingProposal.delay > delay) {
                  // We've found something that will push the
                  // Movable *sooner*. Decrease its delay.
                  existingProposal.delay = delay
                  existingProposal.isPush = isPush
                  heap.updateItem(existingProposal)
               }
            } else {
               // Add an initial proposal to the heap.
               let proposal = { movable: movable, delay, isPush }
               heap.push(proposal)
               proposals.set(movable, proposal)
            }
         }
         return [instructions, rigidSegments]
      }
      let posDir = slideAxis.posDirection()
      let negDir = slideAxis.negDirection()
      let posInstructions, negInstructions, posRigid, negRigid
      if (selectedSlideMode() === "push connected") {
         ;[posInstructions, posRigid] = generateInstructions(posDir, false)
         ;[negInstructions, negRigid] = generateInstructions(negDir, false)
      } else {
         ;[posInstructions, posRigid] = generateInstructions(posDir, true)
         ;[negInstructions, negRigid] = generateInstructions(negDir, true)
      }
      let contactPositions = posInstructions
         .flatMap((i) => (i.isPush ? [i.delay] : []))
         .concat(negInstructions.flatMap((i) => (i.isPush ? [-i.delay] : [])))
      let rigidSegments = new Set([...posRigid.keys(), ...negRigid.keys()])
      let immediatelyMoved = new Set<Segment>()
      for (let [seg, delay] of posRigid) {
         if (delay === 0 && negRigid.get(seg) === 0) immediatelyMoved.add(seg)
      }
      slide = {
         mode: selectedSlideMode(),
         originalPositions: copyPositions(),
         grabbed,
         start: atPart.copy(),
         axis: slideAxis,
         posInstructions,
         negInstructions,
         contactPositions,
         rigidSegments,
         immediatelyMoved,
      }
   }
   function endSlide() {
      slide = null
   }
   function updateDrawAndSlide() {
      if (!draw && !slide) return

      if (draw && draw.mode !== selectedDrawMode()) {
         // Change the draw mode.
         endSlide() // If we were sliding, commit the operation.
         draw.mode = selectedDrawMode()
         if (draw.mode === "strafing") beginDrawStrafing()
      } else if (slide) {
         if (slide.mode !== selectedSlideMode()) {
            let { axis, grabbed } = slide
            endSlide()
            beginSlide(axis, grabbed, mouseOnCanvas)
         } else {
            // Revert the slide operation; it will be redone from scratch.
            for (let m of allMovables())
               m.moveTo(slide.originalPositions.read(m))
         }
      }
      //--- PART 1: Do draw operations that can/must be done before sliding. ---
      let snappedToVertex = false
      let targetSegments = draw
         ? [...Segment.s].filter(
              (seg) =>
                 !seg.isTether() &&
                 ![...draw!.segment.start.edges()].find(([s]) => s === seg)
           )
         : []
      // This function checks whether draw.segment can be displaced toward the
      // given Movable by the given "extra" displacement (i.e. beyond the mouse
      // position), without causing the Movable itself to be moved.
      function canDisplaceTowardMovable(movable: Movable, disp: number) {
         if (!draw || !slide) return true
         // The following expression computes the slide that needs to be
         // performed to move draw.start into alignment with draw.end.
         let slideDistance = mouseOnCanvas
            .displacedBy(draw.segment.axis.orthogonal().scaledBy(disp))
            .displacementFrom(draw.segment.start)
            .inTermsOfBasis([slide.axis, draw.segment.axis])[0]
            .scalarProjectionOnto(slide.axis)
         let instructions =
            slideDistance > 0 ? slide.posInstructions : slide.negInstructions
         slideDistance = Math.abs(slideDistance)
         return !instructions.find(
            (i) => movable === i.movable && slideDistance >= i.delay + err
         )
      }
      if (draw) {
         let associatedDrawAxis: (vertex: Vertex | SpecialAttachPoint) => Axis
         let defaultDrawEnd: Point
         let defaultDrawAxis: Axis
         if (draw.mode === "strafing") {
            associatedDrawAxis = () => draw!.segment.axis
            defaultDrawEnd = mouseOnCanvas
            defaultDrawAxis = draw.segment.axis
         } else {
            associatedDrawAxis = (vertex) =>
               Axis.fromVector(vertex.displacementFrom(draw!.segment.start)) ||
               draw!.segment.axis
            // By default, draw to the mouse position.
            defaultDrawEnd = mouseOnCanvas
            defaultDrawAxis =
               Axis.fromVector(
                  mouseOnCanvas.displacementFrom(draw.segment.start)
               ) || draw.segment.axis
            // But if possible, snap to a nice axis.
            if (draw.mode === "snapped rotation") {
               let adjacentAxes = [...movableAt(draw.segment.start).edges()]
                  .filter(([seg]) => seg !== draw!.segment)
                  .map(([seg]) => seg.axis)
               let niceAxes = new Set([...snapAxes, ...adjacentAxes])
               let closestAxis: Axis | undefined
               let sqDistance: number = Infinity
               for (let axis of niceAxes) {
                  let sqRejection = new Line(draw.segment.start, axis)
                     .partClosestTo(mouseOnCanvas)
                     .sqDistanceFrom(mouseOnCanvas)
                  if (sqRejection < sqDistance) {
                     closestAxis = axis
                     sqDistance = sqRejection
                  }
               }
               if (closestAxis) {
                  let closestPart = new Line(
                     draw.segment.start,
                     closestAxis
                  ).partClosestTo(mouseOnCanvas)
                  if (sqDistance < sqSnapRadius) {
                     defaultDrawEnd = closestPart
                     defaultDrawAxis = closestAxis
                  } else if (sqDistance < sqEaseRadius) {
                     let d = closestPart.directionFrom(
                        mouseOnCanvas
                     ) as Direction
                     defaultDrawEnd = mouseOnCanvas.displacedBy(
                        d.scaledBy(easeFn(Math.sqrt(sqDistance)))
                     )
                     defaultDrawAxis =
                        Axis.fromVector(
                           defaultDrawEnd.displacementFrom(draw.segment.start)
                        ) || draw.segment.axis
                  }
               }
            }
         }
         function isAcceptableVertex(v: Vertex) {
            if (v === draw!.segment.start || v === draw!.end) return false
            let drawAxis = associatedDrawAxis(v)
            let drawDir = v
               .displacementFrom(draw!.segment.start)
               .projectionOnto(drawAxis)
               .direction()
            if (!drawDir) return false
            for (let [{ axis }, other] of v.edges()) {
               // Reject if the segment being drawn would overlap this segment.
               if (axis !== drawAxis) continue
               let dir = v.directionFrom(other)
               if (dir?.approxEquals(drawDir, err)) return false
            }
            if (
               v instanceof Junction &&
               v.host() instanceof Segment &&
               (v.host() as Segment).axis === drawAxis
            ) {
               return false
            }
            if (slide) {
               // Reject if snapping to the vertex is impossible, because the
               // vertex would slide away from the mouse.
               let orthoDisp = v
                  .displacementFrom(mouseOnCanvas)
                  .scalarProjectionOnto(drawAxis.orthogonal())
               if (!canDisplaceTowardMovable(movableAt(v), orthoDisp))
                  return false
            }
            return true
         }
         function isAcceptableAttachPoint(p: SpecialAttachPoint) {
            if (p.sqDistanceFrom(draw!.segment.start) === 0) return false
            let somethingAlreadyAttached = [...p.object.attachments].some(
               (attachment) => attachment.sqDistanceFrom(p) < sqErr
            )
            if (somethingAlreadyAttached) {
               return false // Should interact with the attachment instead.
            }
            if (p.object instanceof SymbolInstance) {
               let orthoDisp = p
                  .displacementFrom(mouseOnCanvas)
                  .scalarProjectionOnto(draw!.segment.axis.orthogonal())
               return canDisplaceTowardMovable(p.object, orthoDisp)
            } else if (associatedDrawAxis(p) === p.object.axis) {
               return false
            } else if (slide) {
               let { start, end } = p.object
               let orthoDisp = p
                  .displacementFrom(mouseOnCanvas)
                  .scalarProjectionOnto(draw!.segment.axis.orthogonal())
               return (
                  canDisplaceTowardMovable(movableAt(start), orthoDisp) &&
                  canDisplaceTowardMovable(movableAt(end), orthoDisp)
               )
            } else return true
         }
         let closestVertex = closestNearTo<Vertex | SpecialAttachPoint>(
            mouseOnCanvas,
            [...allVertices()].filter(isAcceptableVertex)
         )
         if (!closestVertex && specialAttachPointsVisible) {
            closestVertex = closestNearTo(
               mouseOnCanvas,
               [...specialAttachPoints()].filter(isAcceptableAttachPoint)
            )
         }
         if (closestVertex) {
            // Snap to the closest vertex.
            draw.end.moveTo(closestVertex.object)
            draw.segment.updateAxis(associatedDrawAxis(closestVertex.object))
            draw.endObject = closestVertex.object
            snappedToVertex = true
         } else {
            draw.end.moveTo(defaultDrawEnd)
            draw.segment.updateAxis(defaultDrawAxis)
         }
      }
      if (
         draw?.mode === "strafing" &&
         !snappedToVertex &&
         draw.drawAxisRanges &&
         draw.orthoRanges &&
         slide
      ) {
         // Try snapping by strafing towards nearby things.
         let drawAxis = draw.segment.axis
         let orthoAxis = drawAxis.orthogonal()
         let vs = draw.segment.start.displacementFrom(Point.zero)
         let ve = draw.segment.end.displacementFrom(Point.zero)
         let drawRange = new Range1D([
            vs.scalarProjectionOnto(drawAxis),
            ve.scalarProjectionOnto(drawAxis),
         ])
         let orthoRange = new Range1D([ve.scalarProjectionOnto(orthoAxis)])
         // For each axis, find the circuit element closest to draw.segment
         // for which snapping is possible. (Snapping interacts with sliding;
         // we must ignore snapping to things that will ultimately slide.)
         let minDisp = Infinity
         for (let [target, targetDraw] of draw.drawAxisRanges) {
            if (target === draw.segment) continue
            if (target === draw.end) continue
            if (drawRange.intersects(targetDraw)) {
               let targetOrtho = draw.orthoRanges.get(target) as Range1D
               let d = targetOrtho.displacementFromContact(orthoRange)
               let movs = isMovable(target)
                  ? [target]
                  : [movableAt(target.start), movableAt(target.end)]
               if (
                  Math.abs(d) < Math.abs(minDisp) &&
                  movs.every((mov) => canDisplaceTowardMovable(mov, d))
               )
                  minDisp = d
            }
         }
         // Also consider the snap positions of the slide operation.
         let slideDisp = draw.end
            .displacementFrom(draw.segment.start)
            .inTermsOfBasis([slide.axis, draw.segment.axis])[0]
            .scalarProjectionOnto(slide.axis)
         for (let position of slide.contactPositions) {
            let d = slide.axis
               .scaledBy(position - slideDisp)
               .scalarProjectionOnto(orthoAxis)
            if (Math.abs(d) < Math.abs(minDisp)) minDisp = d
         }
         // Perform the snap.
         if (Math.abs(minDisp) >= easeRadius) {
            minDisp = 0
         } else if (Math.abs(minDisp) >= snapRadius) {
            minDisp = Math.sign(minDisp) * easeFn(Math.abs(minDisp))
         }
         draw.end.moveBy(orthoAxis.scaledBy(minDisp))
      }
      // --------------------- PART 2: Perform the slide. ---------------------
      if (slide) {
         // Determine the direction and distance things should move.
         let slideDistance: number
         if (draw) {
            // The required slideDistance has already been determined in PART 1:
            // it is the distance that draw.start needs to move along slide.axis
            // to ensure the orientation of draw.segment remained unchanged.
            let [slideVector] = draw.end
               .displacementFrom(draw.segment.start)
               .inTermsOfBasis([slide.axis, draw.segment.axis])
            slideDistance = slideVector.scalarProjectionOnto(slide.axis)
         } else {
            // The slideDistance is determined by the position of the mouse.
            slideDistance = mouseOnCanvas
               .displacementFrom(slide.start)
               .scalarProjectionOnto(slide.axis)
            // If the current slideDistance is _close_ to the distance at which
            // two objects touch, ease toward that distance.
            let smallestDistance = Infinity
            for (let position of slide.contactPositions) {
               let distance = slideDistance - position
               if (Math.abs(distance) < Math.abs(smallestDistance))
                  smallestDistance = distance
            }
            if (Math.abs(smallestDistance) < snapRadius) {
               slideDistance -= smallestDistance
            } else if (Math.abs(smallestDistance) < easeRadius) {
               slideDistance -=
                  Math.sign(smallestDistance) *
                  easeFn(Math.abs(smallestDistance))
            }
         }
         let direction, instructions
         if (slideDistance > 0) {
            direction = slide.axis.posDirection()
            instructions = slide.posInstructions
         } else {
            direction = slide.axis.negDirection()
            instructions = slide.negInstructions
            slideDistance = -slideDistance
         }
         // Perform the new movement.
         for (let instruction of instructions) {
            let distance = slideDistance - instruction.delay
            if (distance <= 0) break
            instruction.movable.moveBy(direction.scaledBy(distance))
         }
      }
      // ----------------- PART 3: Snap along the draw axis. ------------------
      // Now that sliding has been performed (if applicable), snap the *length*
      // of draw.segment toward things of interest.
      if (draw && !snappedToVertex) {
         draw.endObject = undefined
         let drawAxis = draw.segment.axis
         let orthoAxis = drawAxis.orthogonal()
         let closest = closestSegmentNearTo(draw.end, drawAxis, targetSegments)
         if (closest) {
            // Snap to the nearby segment.
            draw.end.moveTo(closest.closestPart)
            draw.endObject = closest.object
         } else if (config.distanceSnap.state !== "off") {
            // Try snapping draw.end to a standard distance from a nearby
            // circuit element.
            // The circuit needs to be re-projected (every frame!) so that we
            // can figure out what circuit elements are "in front of" draw.end.
            let halfDist = config.distanceSnap.state / 2
            let drawAxisRanges = projectionOfCircuitOnto(drawAxis, halfDist)
            let orthoRanges = projectionOfCircuitOnto(orthoAxis, halfDist)
            let drawEndRange = drawAxisRanges.get(draw.end) as Range1D
            let orthoRange = orthoRanges.get(draw.end) as Range1D
            // Find the closest thing that draw.end can snap toward.
            let minDisp = Infinity
            for (let [target, targetOrtho] of orthoRanges) {
               if (target === draw.segment) continue
               if (target === draw.end) continue
               if (target instanceof Junction) continue
               if (orthoRange.intersects(targetOrtho)) {
                  let targetDraw = drawAxisRanges.get(target) as Range1D
                  let d = targetDraw.displacementFromContact(drawEndRange)
                  if (Math.abs(d) < Math.abs(minDisp)) minDisp = d
               }
            }
            // Perform the snap.
            if (Math.abs(minDisp) >= easeRadius) {
               minDisp = 0
            } else if (Math.abs(minDisp) >= snapRadius) {
               minDisp = Math.sign(minDisp) * easeFn(Math.abs(minDisp))
            }
            draw.end.moveBy(drawAxis.scaledBy(minDisp))
         }
      }
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
      amassed.items = amassed.items
   }
   function beginWarp(grabbed: Grabbable, partGrabbed: Point) {
      let movables = new Set<Movable>()
      let rigidSegments = new Set<Segment>()
      // Gather all the Movables that should be warped.
      if (amassed.items.has(grabbed)) {
         amassed.items.forEach((item) => add(item))
      } else if (isNextToAmassed(grabbed)) {
         amassed.items.forEach((item) => add(item))
         add(grabbed)
      } else {
         add(grabbed)
      }
      function add(thing: Interactable) {
         if (isMovable(thing)) {
            addMovable(thing)
         } else if (thing instanceof Segment) {
            addMovable(movableAt(thing.start))
            addMovable(movableAt(thing.end))
         } else {
            // Ignore ports and crossings.
         }
      }
      // Add Movables via a depth-first search.
      function addMovable(m: Movable) {
         if (movables.has(m)) return // avoid infinite loops
         movables.add(m)
         if (m instanceof SymbolInstance) {
            // Attachments must move with their host.
            for (let a of m.attachments) addMovable(a)
         } else if (m instanceof Junction) {
            // Hosts must move with their attachments.
            let host = m.host()
            if (host instanceof SymbolInstance) {
               addMovable(host)
            } else if (host instanceof Segment) {
               addMovable(movableAt(host.start))
               addMovable(movableAt(host.end))
            }
         }
         for (let [segment, v] of m.edges()) {
            if (segment.isRigid() || segment.attachments.size > 0) {
               // Treat the segment as rigid.
               addMovable(movableAt(v))
               // Attachments must move with their host.
               for (let a of segment.attachments) addMovable(a)
               if (segment.isRigid()) rigidSegments.add(segment)
            }
         }
      }
      function isNextToAmassed(thing: Interactable): boolean {
         // "Next to" has a meaning specific to the warp operation.
         function edgeIsAmassed(edge: Edge): boolean {
            return amassed.items.has(edge[0])
         }
         return (
            ((thing instanceof Junction ||
               thing instanceof SymbolInstance ||
               thing instanceof Port) &&
               [...thing.edges()].some(edgeIsAmassed)) ||
            (thing instanceof Segment &&
               (amassed.items.has(movableAt(thing.start)) ||
                  amassed.items.has(movableAt(thing.end)) ||
                  [...movableAt(thing.start).edges()].some(edgeIsAmassed) ||
                  [...movableAt(thing.end).edges()].some(edgeIsAmassed)))
         )
      }
      // Compute the point about which rotation should occur.
      let d = zeroVector
      for (let m of movables) {
         let p = m instanceof SymbolInstance ? m.center() : m
         d = d.add(p.displacementFrom(Point.zero))
      }
      let centroid = Point.zero.displacedBy(d.scaledBy(1 / movables.size))
      // Determine which rotations will align the axes of the selected items
      // with the snapAxes.
      let selectedAxes = new Set<Axis>()
      for (let movable of movables) {
         // Consider the axes of segments that lie between selected items.
         for (let [segment, farVertex] of movable.edges()) {
            if (movables.has(movableAt(farVertex)))
               selectedAxes.add(segment.axis)
         }
         // Consider the intrinsic axis of Symbols.
         if (movable instanceof SymbolInstance)
            selectedAxes.add(Axis.horizontal.rotatedBy(movable.rotation))
      }
      let keyRotations = new Set<Rotation>()
      for (let axis of selectedAxes) {
         for (let snap of snapAxes) {
            let dir = snap.posDirection()
            keyRotations.add(dir.rotationFrom(axis.posDirection()))
            keyRotations.add(dir.rotationFrom(axis.negDirection()))
         }
      }
      // Gather the edges that may be affected by a warp.
      let affectedEdges = [...movables].flatMap((m) => [...m.edges()])
      let incidentEdges = new Set(
         affectedEdges.filter(([_, v]) => !movables.has(movableAt(v)))
      )
      let affectedSegments = new Set(affectedEdges.map(([seg]) => seg))
      warp = {
         mode: selectedWarpMode(),
         grabbed,
         movables,
         centroid,
         keyRotations,
         incidentEdges,
         affectedSegments,
         rigidSegments,
         originalPositions: copyPositions(),
         originalRotations: copySymbolRotations(),
         start: partGrabbed,
         splice: null,
         highlight: new Set(),
      }
   }
   function updateWarp() {
      if (!warp) return
      if (warp.mode !== selectedWarpMode()) {
         let { grabbed } = warp
         // Re-initialize the warp.
         beginWarp(grabbed, mouseOnCanvas)
      } else {
         // Revert the operation; it will be redone from scratch.
         for (let m of warp.movables) {
            m.moveTo(warp.originalPositions.read(m))
            if (m instanceof SymbolInstance) {
               ;(m.rotation as Rotation) = warp.originalRotations.read(m)
            }
         }
         warp.splice = null
         warp.highlight.clear()
      }
      if (warp.mode === "pan") {
         updatePan()
      } else {
         updateRotate()
      }
   }
   function updatePan() {
      if (!warp) return
      // Start by moving everything as if it was following the mouse.
      {
         let displacement = mouseOnCanvas.displacementFrom(warp.start)
         for (let movable of warp.movables) movable.moveBy(displacement)
      }
      // If panning a lone symbol, we will attempt to snap its ports to other
      // ports.
      let loneSymbol: SymbolInstance | undefined
      if (warp.movables.size === 1) {
         let item = [...warp.movables][0]
         if (item instanceof SymbolInstance && item.edges().size === 0) {
            loneSymbol = item
         }
      }
      if (loneSymbol) {
         // Try easing the symbol toward a segment that it can be spliced into.
         // We can either splice a _single_ port into a segment, or a _pair_
         // of ports. To splice a pair of ports, the ports must lie on the
         // same axis as the segment they are being spliced into. Thus, we
         // begin by iterating over all of the "snapAxes", and identify the
         // port pairs that lie on that axis. There are some subtle challenges:
         // — If 3+ ports are colinear, then it is not clear which pair should
         //   be spliced. Thus, we will not attempt to splice any of them.
         // — We should only splice a single port if it is _not_ part of a pair.
         // The code below addresses these challenges. For each axis, it finds
         // the ports and port pairs that it is acceptable to splice with.
         let acceptableSegmentSnaps = new DefaultMap<
            Axis,
            Set<Port | [Port, Port]>
         >(() => new Set())
         for (let axis of snapAxes) {
            let pairs = new Set<[Port, Port]>()
            let timesUsed = new DefaultMap<Port, number>(() => 0)
            for (let i = 0; i < loneSymbol.ports.length; ++i) {
               let p1 = loneSymbol.ports[i]
               for (let j = i + 1; j < loneSymbol.ports.length; ++j) {
                  let p2 = loneSymbol.ports[j]
                  if (Axis.fromVector(p2.displacementFrom(p1)) !== axis)
                     continue // Only consider pairs that lie on the axis.
                  pairs.add([p1, p2])
                  timesUsed.set(p1, timesUsed.read(p1) + 1)
                  timesUsed.set(p2, timesUsed.read(p2) + 1)
               }
            }
            let snaps = new Set<Port | [Port, Port]>()
            // We can only snap to a pair of ports if it is not colinear with
            // any other pair. (If a port has been used in multiple pairs,
            // then those pairs are colinear. And vice versa.)
            for (let [p1, p2] of pairs) {
               if (timesUsed.read(p1) === 1 && timesUsed.read(p2) === 1)
                  snaps.add([p1, p2])
            }
            // We can only snap to a single port if it is not part of a pair.
            for (let port of loneSymbol.ports) {
               if (timesUsed.read(port) === 0) snaps.add(port)
            }
            acceptableSegmentSnaps.set(axis, snaps)
         }
         // Now that we've identified all of the acceptable ports and port-pairs
         // to snap/splice onto a segment, iterate over all segments to find the
         // closest snap.
         let snapToSegment:
            | { source: Port | [Port, Port]; target: Segment }
            | undefined
         let sqDistanceForSegmentSnap = Infinity
         for (let target of Segment.s) {
            for (let source of acceptableSegmentSnaps.read(target.axis)) {
               if (source instanceof Port) {
                  if (source.projectsOnto(target)) {
                     let sqDistance = target.sqDistanceFrom(source)
                     if (sqDistance < sqDistanceForSegmentSnap) {
                        snapToSegment = { source, target }
                        sqDistanceForSegmentSnap = sqDistance
                     }
                  }
               } else {
                  let [p1, p2] = source
                  if (p1.projectsOnto(target) && p2.projectsOnto(target)) {
                     let sqDistance = target.sqDistanceFrom(p1)
                     if (sqDistance < sqDistanceForSegmentSnap) {
                        snapToSegment = { source, target }
                        sqDistanceForSegmentSnap = sqDistance
                     }
                  }
               }
            }
         }
         // We now have the information required to snap/splice the symbol's
         // port pairs onto the closest segment. But we are also interested in
         // snapping the symbol's ports onto other ports in the circuit. We will
         // compute this information next.
         let snapToPort: { source: Port; target: Port } | undefined
         let sqDistanceForPortSnap = Infinity
         for (let source of loneSymbol.ports) {
            for (let target of Port.s) {
               if (target.symbol === loneSymbol) continue
               let sqDistance = target.sqDistanceFrom(source)
               if (sqDistance < sqDistanceForPortSnap) {
                  snapToPort = { source, target }
                  sqDistanceForPortSnap = sqDistance
               }
            }
         }
         // Do whichever snapping operation requires the smallest displacement.
         if (
            snapToSegment &&
            sqDistanceForSegmentSnap < sqDistanceForPortSnap
         ) {
            let { source, target } = snapToSegment
            let itemsToHighlight =
               source instanceof Port ? [source, target] : [...source, target]
            let d =
               source instanceof Port
                  ? target.partClosestTo(source).displacementFrom(source)
                  : target.partClosestTo(source[0]).displacementFrom(source[0])
            if (d.sqLength() < sqSnapRadius) {
               loneSymbol.moveBy(d)
               for (let thing of itemsToHighlight) warp.highlight.add(thing)
               // In addition to snapping immediately, save the info we need to
               // splice the symbol. This will occur when the mouse is released.
               warp.splice = { source, target }
            } else if (d.sqLength() < sqEaseRadius) {
               loneSymbol.moveBy(
                  d.direction()?.scaledBy(easeFn(d.length())) as Vector
               )
            }
         } else if (snapToPort) {
            let d = snapToPort.target.displacementFrom(snapToPort.source)
            if (d.sqLength() < sqSnapRadius) {
               loneSymbol.moveBy(d)
               warp.highlight.add(snapToPort.source)
            } else if (d.sqLength() < sqEaseRadius) {
               loneSymbol.moveBy(
                  d.direction()?.scaledBy(easeFn(d.length())) as Vector
               )
            }
         }
      } else if (config.angleSnap.state === "on") {
         // Try easing the edges incident to the warped items (i.e. the
         // segments being stretched) toward "nice" axes.

         // Begin by gathering the axes of interest.
         let neighbourAxes = new Set(
            [...warp.incidentEdges].flatMap(([s, neighbour]) =>
               [...neighbour.edges()]
                  .filter(([_, v]) => !warp!.movables.has(movableAt(v)))
                  .map(([segment]) => segment.axis)
            )
         )
         // We aim to displace ("snap") the Movables slightly such that their
         // incident edges will have a "nice" axis.
         let niceAxes = [...snapAxes, ...neighbourAxes]

         // Begin by computing the minimum rejection from each axis.
         let axisRejections = new DefaultMap<Axis, Vector>(() => infinityVector)
         for (let [segment, farVertex] of warp.incidentEdges) {
            let nearVertex =
               farVertex === segment.end ? segment.start : segment.end
            for (let axis of niceAxes) {
               let rejection = new Line(farVertex, axis)
                  .partClosestTo(nearVertex)
                  .displacementFrom(nearVertex)
               if (rejection.sqLength() < axisRejections.read(axis).sqLength())
                  axisRejections.set(axis, rejection)
            }
         }
         // Sort the rejections so that the two smallest ones can be used.
         let rejections = [...axisRejections].sort(
            (x, y) => x[1].sqLength() - y[1].sqLength()
         )
         let oneAxisDisplacement = infinityVector
         if (rejections.length >= 1) {
            oneAxisDisplacement = rejections[0][1]
         }
         let twoAxisDisplacement = infinityVector
         if (rejections.length >= 2) {
            // Find the displacement vector that satisfies both of the
            // rejections simultaneously. (Take the intersection of the dual
            // lines associated with each displacement vector.)
            let [[axis1, reject1], [axis2, reject2]] = rejections
            let dualLine1 = new Line(Point.zero.displacedBy(reject1), axis1)
            let dualLine2 = new Line(Point.zero.displacedBy(reject2), axis2)
            let intersection = dualLine1.intersection(dualLine2)
            if (intersection) {
               twoAxisDisplacement = intersection.displacementFrom(Point.zero)
            }
         }
         let displacement = zeroVector
         // First, ease to the nearest axis. This keeps the movement "on a rail".
         let sqLength1 = oneAxisDisplacement.sqLength()
         if (sqLength1 < sqSnapRadius) {
            displacement = oneAxisDisplacement
         } else if (sqLength1 < sqEaseRadius) {
            displacement = oneAxisDisplacement
               .direction()
               ?.scaledBy(easeFn(Math.sqrt(sqLength1))) as Vector
         }
         // Next, ease to the intersection.
         let remainingDisplacement = twoAxisDisplacement.sub(displacement)
         let sqLength2 = remainingDisplacement.sqLength()
         if (sqLength2 < sqSnapRadius) {
            displacement = twoAxisDisplacement
         } else if (sqLength2 < sqEaseRadius) {
            displacement = displacement.add(
               remainingDisplacement
                  .direction()
                  ?.scaledBy(easeFn(Math.sqrt(sqLength2))) as Vector
            )
         }
         // Execute the movement.
         for (let movable of warp.movables) movable.moveBy(displacement)
      }

      // Finally, update the axis of each incident edge.
      for (let [segment] of warp.incidentEdges) {
         let axis = Axis.fromVector(segment.end.displacementFrom(segment.start))
         if (!axis) continue
         segment.updateAxis(axis)
      }
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
      amassed.items = amassed.items
   }
   function updateRotate() {
      if (!warp) return
      // First, find the magnitude of the rotation to be performed.
      let startDir =
         warp.start.directionFrom(warp.centroid) || Direction.negativeY
      let mouseDir =
         mouseOnCanvas.directionFrom(warp.centroid) || Direction.negativeY
      let mouseRotation = mouseDir.rotationFrom(startDir)

      // Then, if the rotation is close to a keyRotation, ease to it.
      let easedRotation = mouseRotation
      if (config.angleSnap.state === "on") {
         let closest: Rotation = Rotation.fromDegrees(180)
         for (let key of warp.keyRotations) {
            let r = key.sub(mouseRotation)
            if (Math.abs(r.toRadians()) < Math.abs(closest.toRadians()))
               closest = r
         }
         let radius = mouseOnCanvas.distanceFrom(warp.centroid)
         let arcLength = radius * Math.abs(closest.toRadians())
         if (arcLength < snapRadius) {
            easedRotation = mouseRotation.add(closest)
         } else if (arcLength < easeRadius) {
            let scale = easeFn(arcLength) / arcLength
            easedRotation = mouseRotation.add(closest.scaledBy(scale))
         }
      }
      // Then, apply the rotation.
      for (let m of warp.movables) m.rotateAround(warp.centroid, easedRotation)

      // Finally, update the axis of each edge that may have been rotated.
      for (let segment of warp.affectedSegments) {
         let axis = Axis.fromVector(segment.end.displacementFrom(segment.start))
         if (!axis) continue
         segment.updateAxis(axis)
      }

      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
      amassed.items = amassed.items
   }
   function endWarp() {
      if (!warp) return
      if (warp.splice) {
         if (warp.splice.source instanceof Port) {
            warp.splice.target.splitAt(warp.splice.source)
         } else {
            warp.splice.target.spliceAt(warp.splice.source)
         }
      }
      warp = null
   }
   function beginAmassRect(start: Point) {
      amassRect = {
         mode: keyInfo.read(Alt).pressing ? "remove" : "add",
         start,
         items: new Set(),
      }
   }
   function beginEraseRect(start: Point) {
      eraseRect = { start, items: new Set() }
   }
   function beginFreezeRect(start: Point) {
      freezeRect = {
         mode: keyInfo.read(Alt).pressing ? "remove" : "add",
         start,
         items: new Set(),
      }
   }
   function updateAmassRect() {
      if (!amassRect) return
      amassRect.items = new Set()
      let range = Range2D.fromCorners(amassRect.start, mouseOnCanvas)
      for (let segment of Segment.s)
         if (range.intersects(segment)) amassRect.items.add(segment)
      if (config.showSymbols.state === "on" || amassRect.mode === "remove")
         for (let symbol of SymbolInstance.s)
            if (range.intersects(symbol)) amassRect.items.add(symbol)
      if (amassRect.mode === "remove") {
         for (let vertex of allVertices())
            if (range.intersects(vertex)) amassRect.items.add(vertex)
         for (let crossing of allCrossings())
            if (range.intersects(crossing.point)) amassRect.items.add(crossing)
      }
   }
   function updateEraseRect() {
      if (!eraseRect) return
      eraseRect.items = new Set()
      let range = Range2D.fromCorners(eraseRect.start, mouseOnCanvas)
      for (let segment of Segment.s)
         if (range.intersects(segment)) eraseRect.items.add(segment)
      if (config.showSymbols.state === "on")
         for (let symbol of SymbolInstance.s)
            if (range.intersects(symbol)) eraseRect.items.add(symbol)
   }
   function updateFreezeRect() {
      if (!freezeRect) return
      freezeRect.items = new Set()
      let range = Range2D.fromCorners(freezeRect.start, mouseOnCanvas)
      for (let segment of Segment.s)
         if (range.intersects(segment)) freezeRect.items.add(segment)
   }
   function endAmassRect() {
      if (!amassRect) return
      if (amassRect.mode === "remove") {
         for (let item of amassRect.items) amassed.items.delete(item)
      } else {
         for (let item of amassRect.items) {
            amassed.items.add(item)
            if (item instanceof Segment) {
               // The segment's crossings should be unselected.
               for (let [_, cross] of crossingMap.read(item))
                  amassed.items.delete(cross)
            }
         }
      }
      amassed.items = amassed.items
      amassRect = null
   }
   function endEraseRect() {
      if (!eraseRect) return
      deleteItems(eraseRect.items)
      eraseRect = null
   }
   function endFreezeRect() {
      if (!freezeRect) return
      if (freezeRect.mode === "remove") {
         for (let item of freezeRect.items) item.isFrozen = false
      } else {
         for (let item of freezeRect.items) item.isFrozen = true
      }
      Segment.s = Segment.s
      freezeRect = null
   }
   function abortAllButtons() {
      for (let key of keyInfo.keys()) keyAborted(key)
   }
   function deleteItems(items: Iterable<Interactable>) {
      let junctionsToFuse = new Set<Junction>()
      for (let thing of items) {
         if (thing instanceof Port || thing instanceof Crossing) continue
         thing.delete().forEach((neighbor) => junctionsToFuse.add(neighbor))
      }
      for (let junction of junctionsToFuse) {
         if (junction.edges().size === 2 && !junction.host()) junction.fuse()
      }
      // Tell Svelte all of these things could have changed.
      Junction.s = Junction.s
      Segment.s = Segment.s
      SymbolInstance.s = SymbolInstance.s
      Port.s = Port.s
      amassed.items = amassed.items
   }

   // --------------------- Development-time behaviours -----------------------
   onMount(() => {
      // After a hot reload, the SVGs of symbols must re-inserted into the DOM.
      for (let symbol of SymbolInstance.s) symbol.refresh()
   })
</script>

<svelte:window
   on:mousemove={updateModifierKeys}
   on:keydown={(event) => {
      updateModifierKeys(event)
      let inputElementActive =
         document.activeElement?.tagName.toLowerCase() === "input" ||
         document.activeElement?.tagName.toLowerCase() === "textarea"
      if (!inputElementActive) {
         if (keyInfo.read(Control).pressing) {
            if (command(event.code, event.repeat) === "recognized")
               event.preventDefault()
         } else if (!event.repeat) {
            keyPressed(event.code)
         }
         if (event.code === "Space") event.preventDefault() // Don't scroll
      }
   }}
   on:keyup={(event) => {
      updateModifierKeys(event)
      keyReleased(event.code)
   }}
   on:wheel|capture|passive={(event) => {
      let yMagnitude = Math.abs(asAny(event).wheelDeltaY)
      if (
         !usingTrackpad &&
         event.deltaX !== 0 &&
         !keyInfo.read(Shift).pressing
      ) {
         usingTrackpad = true
         mouselikeWheelEvents = 0
         console.log("Switched to trackpad mode.")
      } else if (
         usingTrackpad &&
         yMagnitude > 3 && // above min value for trackpad
         (mouselikeWheelEvents === 0 || yMagnitude === lastYMagnitude) &&
         timeSince(timeOfLastWheelEvent) > seconds(0.05) &&
         !event.ctrlKey
      ) {
         mouselikeWheelEvents += 1
         if (mouselikeWheelEvents >= 3) {
            usingTrackpad = false
            mouselikeWheelEvents = 0
            console.log("Switched to mouse mode.")
         }
      } else {
         mouselikeWheelEvents = 0
      }
      timeOfLastWheelEvent = now()
      lastYMagnitude = yMagnitude
   }}
   on:blur={() => {
      abortAllButtons()
   }}
   on:resize={() => {
      if (canvas) {
         canvasWidth = canvas.getBoundingClientRect().width
         canvasHeight = canvas.getBoundingClientRect().height
      }
   }}
   on:beforeunload={async (event) => {
      if (
         projectFolder &&
         worker &&
         history.timestampOfLastSave !== history.timestamp
      ) {
         // Cancel the page closing so that a save operation can be performed.
         event.preventDefault()
         event.returnValue = "" // Chrome requires this for some reason.
         let save = await worker.saveHistory(
            path.join(projectFolder, autosaveFileName)
         )
         if (
            save.outcome === "success" ||
            confirm(
               `Failed to save the project.\nReason: ${save.error.message}\nQuit anyway?`
            )
         ) {
            history.timestampOfLastSave = history.timestamp
            // Now try closing the page again.
            electron.ipcRenderer.invoke("quit")
         }
      }
   }}
/>

<div
   id="app"
   on:contextmenu={(event) => {
      // Disable the context menu.
      event.preventDefault()
      return false
   }}
   on:mousemove|capture={(event) => {
      mouseInClient = new Point(event.clientX, event.clientY)
      if (!leftMouseIsDown(event) && keyInfo.read(LMB).pressing) {
         if (waitedOneFrameLMB) keyAborted(LMB)
         else waitedOneFrameLMB = true
      } else {
         waitedOneFrameLMB = false
      }
      if (!middleMouseIsDown(event) && keyInfo.read(MMB).pressing) {
         if (waitedOneFrameMMB) keyAborted(MMB)
         else waitedOneFrameMMB = true
      } else {
         waitedOneFrameMMB = false
      }
      if (!rightMouseIsDown(event) && keyInfo.read(RMB).pressing) {
         if (waitedOneFrameRMB) keyAborted(RMB)
         else waitedOneFrameRMB = true
      } else {
         waitedOneFrameRMB = false
      }
      mouseMoved()
   }}
   on:mousedown|capture={(event) => {
      mouseInClient = new Point(event.clientX, event.clientY)
   }}
   on:mouseup|capture={(event) => {
      mouseInClient = new Point(event.clientX, event.clientY)
      if (!leftMouseIsDown(event)) keyReleased(LMB)
      if (!middleMouseIsDown(event)) keyReleased(MMB)
      if (!rightMouseIsDown(event)) keyReleased(RMB)
   }}
   on:wheel|capture|nonpassive={(event) => {
      // Turn off the browser's built-in pinch-zoom behaviour.
      if (event.ctrlKey) event.preventDefault()
      // Prevent left and right swipes from triggering page forward/back.
      if (event.deltaX !== 0) event.preventDefault()
   }}
>
   <svg
      class="canvas cursor-{currentCursor}"
      bind:this={canvas}
      on:mouseenter={() => {
         if (grabbedSymbol) {
            spawnSymbol(grabbedSymbol.kind, grabbedSymbol.grabOffset)
            keyInfo.getOrCreate(LMB).pressing = true
            grabbedSymbol = null
         }
      }}
      on:mousedown={(event) => {
         if (leftMouseIsDown(event)) keyPressed(LMB)
         if (middleMouseIsDown(event)) keyPressed(MMB)
         if (rightMouseIsDown(event)) keyPressed(RMB)
      }}
      on:wheel={(event) => {
         event.preventDefault()
         let dx = event.deltaX / window.devicePixelRatio
         let dy = event.deltaY / window.devicePixelRatio
         if (usingTrackpad) {
            if (event.ctrlKey) {
               // Pinch zoom emits a fake "ctrl" modifier.
               executeZoom(-dy * pinchZoomSpeed)
            } else {
               let movement = new Vector(dx, dy).scaledBy(panSpeed / cameraZoom)
               committedCameraPosition =
                  committedCameraPosition.displacedBy(movement)
               // Moving the camera moves the position of the mouse on the
               // canvas, so we need to trigger the corresponding event.
               mouseMoved()
            }
         } else {
            executeZoom(mouseWheelIncrements(event) * wheelZoomSpeed)
            if (Math.abs(cameraZoom - 1) < err) cameraZoom = 1
         }
      }}
   >
      <!--- Camera transform --->
      <g
         transform="scale({cameraZoom}) translate({svgTranslate.x} {svgTranslate.y})"
      >
         <g id="hidden symbol layer">
            {#if config.showSymbols.state === "off"}
               {#each [...SymbolInstance.s] as symbol}
                  {@const c = symbol.svgCorners()}
                  <polygon
                     class="hiddenSymbol {amassLight.has(symbol)
                        ? 'amassLight'
                        : ''}"
                     points="{c[0].x},{c[0].y} {c[1].x},{c[1].y} {c[2].x},{c[2]
                        .y} {c[3].x},{c[3].y}"
                  />
               {/each}
            {/if}
         </g>
         <g id="symbol amassLight layer" class="amassLight" />
         <g id="symbol touchLight layer" class="touchLight" />
         <g id="segment rigidLight layer">
            {#each [...segmentsToDraw] as [segment, sections]}
               {#if rigidLight.has(segment) && !willBeDeleted(segment)}
                  <g
                     class={segment.isFrozen ||
                     (freezeRect?.mode === "add" &&
                        freezeRect?.items.has(segment))
                        ? "freezeLight"
                        : "rigidLight"}
                  >
                     {#each sections as section}
                        <CircuitLine
                           type={segment.type}
                           segment={section}
                           render="rigid"
                        />
                     {/each}
                  </g>
               {/if}
            {/each}
         </g>
         <g id="segment amassLight layer" class="amassLight">
            {#each [...segmentsToDraw] as [segment, sections]}
               {#if amassLight.has(segment) && !willBeDeleted(segment)}
                  {#each sections as section}
                     <CircuitLine
                        type={segment.type}
                        segment={section}
                        render="highlight"
                     />
                  {/each}
               {/if}
            {/each}
         </g>
         <g id="segment touchLight layer" class="touchLight">
            {#each [...segmentsToDraw] as [segment, sections]}
               {#if touchLight.has(segment) && !willBeDeleted(segment)}
                  {#each sections as section}
                     <CircuitLine
                        type={segment.type}
                        segment={section}
                        render="highlight"
                     />
                  {/each}
               {/if}
            {/each}
         </g>
         <g id="segment layer">
            {#each [...segmentsToDraw] as [segment, sections]}
               {#if !willBeDeleted(segment) && !(segment.isTether() && config.showTethers.state == "off")}
                  {#each sections as section}
                     <CircuitLine
                        type={segment.type}
                        color={segment.renderColor()}
                        segment={section}
                     />
                  {/each}
               {/if}
            {/each}
         </g>
         <!-- Segment glyph highlight layer -->
         <g>
            <!-- TODO: This is occurrence 1/4 of the glyph-generating code.-->
            {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
               {@const className =
                  glyph.style === "touch" ? "touchLight" : "amassLight"}
               {#if glyph.type === "vertex glyph" && layerOf(glyph.position) === "lower" && !willBeDeleted(glyph)}
                  {@const port = glyph.glyph.ports[0]}
                  <g
                     class={className}
                     transform="translate({glyph.position.x} {glyph.position
                        .y}) rotate({glyph.rotation}) translate({-port.x}, {-port.y})"
                  >
                     <use href="#{glyph.glyph.fileName}-highlight" />
                  </g>
               {:else if glyph.type === "crossing glyph" && !willBeDeleted(glyph)}
                  <g
                     class={className}
                     transform="translate({glyph.position.x} {glyph.position
                        .y}) rotate({glyph.rotation})"
                  >
                     <use href="#{glyph.glyph.fileName}-highlight" />
                  </g>
               {/if}
            {/each}
         </g>
         <!-- Segment glyph layer -->
         <g>
            <!-- TODO: This is occurrence 2/4 of the glyph-generating code.-->
            {#each [...glyphsToDraw] as glyph}
               {#if glyph.type === "vertex glyph" && layerOf(glyph.position) === "lower" && !willBeDeleted(glyph)}
                  {@const port = glyph.glyph.ports[0]}
                  <g
                     color={glyph.inheritedColor}
                     transform="translate({glyph.position.x} {glyph.position
                        .y}) rotate({glyph.rotation}) translate({-port.x}, {-port.y})"
                  >
                     <use href="#{glyph.glyph.fileName}" />
                  </g>
               {:else if glyph.type === "crossing glyph" && !willBeDeleted(glyph)}
                  <g
                     color={glyph.inheritedColor}
                     transform="translate({glyph.position.x} {glyph.position
                        .y}) rotate({glyph.rotation})"
                  >
                     <use href="#{glyph.glyph.fileName}" />
                  </g>
               {/if}
            {/each}
         </g>
         <!-- Symbol layer -->
         <g
            id="symbol layer"
            style="display: {config.showSymbols.state === 'on'
               ? 'initial'
               : 'none'}"
         />
         <!-- Symbol glyph highlight layer -->
         <g>
            <!-- TODO: This is occurrence 3/4 of the glyph-generating code.-->
            {#each [...glyphsToDraw].filter((g) => g.style) as glyph}
               {#if glyph.type === "vertex glyph" && layerOf(glyph.position) === "upper" && !willBeDeleted(glyph)}
                  {@const port = glyph.glyph.ports[0]}
                  <g
                     class={glyph.style === "touch"
                        ? "touchLight"
                        : "amassLight"}
                     transform="translate({glyph.position.x} {glyph.position
                        .y}) rotate({glyph.rotation}) translate({-port.x}, {-port.y})"
                  >
                     <use href="#{glyph.glyph.fileName}-highlight" />
                  </g>
               {/if}
            {/each}
         </g>
         <!-- Symbol glyph layer -->
         <g>
            <!-- TODO: This is occurrence 4/4 of the glyph-generating code.-->
            {#each [...glyphsToDraw] as glyph}
               {#if glyph.type === "vertex glyph" && layerOf(glyph.position) === "upper" && !willBeDeleted(glyph)}
                  {@const port = glyph.glyph.ports[0]}
                  <g
                     color={glyph.inheritedColor}
                     transform="translate({glyph.position.x} {glyph.position
                        .y}) rotate({glyph.rotation}) translate({-port.x}, {-port.y})"
                  >
                     <use href="#{glyph.glyph.fileName}" />
                  </g>
               {/if}
            {/each}
         </g>
         <!-- HUD layer -->
         <g>
            {#each [...attachmentErrors] as { source, target }}
               <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="red"
                  stroke-width="2"
               />
            {/each}
         </g>
         <g>
            {#if config.showSymbolSnaps.state === "on"}
               {#each [...SymbolInstance.s] as symbol}
                  {@const c = symbol.corners()}
                  <polygon
                     style="fill: none; stroke: red; stroke-width: {2 /
                        cameraZoom}px"
                     points="{c[0].x},{c[0].y} {c[1].x},{c[1].y} {c[2].x},{c[2]
                        .y} {c[3].x},{c[3].y}"
                  />
                  {#each symbol.ports as port}
                     <circle
                        style="fill: none; stroke: red; stroke-width: {2 /
                           cameraZoom}px"
                        cx={port.x}
                        cy={port.y}
                        r={6 / cameraZoom}
                     />
                  {/each}
               {/each}
            {/if}
         </g>
         <g>
            <!-- Selection boxes -->
            {#if amassRect}
               <RectSelectBox
                  start={amassRect.start}
                  end={mouseOnCanvas}
                  scale={cameraZoom}
               />{/if}
            {#if eraseRect}
               <RectSelectBox
                  start={eraseRect.start}
                  end={mouseOnCanvas}
                  scale={cameraZoom}
               />
            {/if}
            {#if freezeRect}
               <RectSelectBox
                  start={freezeRect.start}
                  end={mouseOnCanvas}
                  scale={cameraZoom}
               />
            {/if}
         </g>
      </g>
   </svg>

   <div class="left sidebar">
      <div class="topThings">
         <div class="projectPane">
            <button on:click={openProjectFolder}>Choose a project folder</button
            >
            {#if projectFolder}
               <div><b>Project name:</b> {path.basename(projectFolder)}</div>
            {:else}
               <div>No folder chosen.</div>
            {/if}
         </div>
         <div class="paneTitle">Inspector</div>
      </div>
      <div class="inspectorPane">
         <div class="inspectorItemSummary">{inspectorItemSummary}</div>
         <div class="inspectorBody">
            {#if inspector.mode === "vertex"}
               <div class="inspectorSubtitle">Glyph</div>
               <GlyphSelectionBox
                  glyphsToShow={vertexGlyphKinds}
                  glyphsToHighlight={inspector.glyphs}
                  glyphSelected={setVertexGlyphs}
               />
               <div class="spacer" />
               <div class="inspectorSubtitle">Glyph orientation</div>
               <div class="radioButtons">
                  <FakeRadioButton
                     label="Fixed"
                     checked={inspector.glyphOrientations === "fixed"}
                     onClick={() => orientVertexGlyphs("fixed")}
                  />
                  <FakeRadioButton
                     label="Inherit from segment"
                     checked={inspector.glyphOrientations === "inherit"}
                     onClick={() => orientVertexGlyphs("inherit")}
                  />
               </div>
            {:else if inspector.mode === "crossing"}
               <div class="inspectorSubtitle">Glyph</div>
               <GlyphSelectionBox
                  glyphsToShow={crossingGlyphKinds}
                  glyphsToHighlight={inspector.glyphs}
                  glyphSelected={setCrossingGlyphs}
               />
               <div class="spacer" />
               <div class="inspectorSubtitle">Glyph orientation</div>
               <div class="rotateButtons">
                  <div
                     class="rotateButton"
                     on:mousedown={() => rotateCrossingGlyphs("anticlockwise")}
                  >
                     ↺
                  </div>
                  <div
                     class="rotateButton"
                     on:mousedown={() => rotateCrossingGlyphs("clockwise")}
                  >
                     ↻
                  </div>
               </div>
            {:else if inspector.mode === "segment"}
               <div class="inspectorSubtitle">Segment color</div>
               <TextBox
                  width={110}
                  text={inspector.color}
                  onSubmit={(color) => setColorOfSegments(color)}
               />
            {:else if inspector.mode === "symbol"}
               {#if inspector.canFlip}
                  <div class="symbolMoveButton flip" on:mousedown={flipSymbols}>
                     Flip
                  </div>
               {:else}
                  <div style="display: flex; gap: 5px;">
                     <div class="symbolMoveButton flip disabled">Flip</div>
                     <div class="flipMessage">Symbols must be unconnected.</div>
                  </div>
               {/if}
               <div
                  class="symbolMoveButton send"
                  on:mousedown={sendSymbolsToBack}
               >
                  Send to back
               </div>
               <div
                  class="symbolMoveButton bring"
                  on:mousedown={bringSymbolsToFront}
               >
                  Bring to front
               </div>
            {/if}
            {#if inspector.mode && inspector.mode !== "crossing"}
               <button on:click={addEmptyTag}>New tag</button>
               {#each inspector.tags as { tag, count }}
                  <div class="tag">
                     <div class="count">{count}</div>
                     <TextBox
                        width={110}
                        text={tag}
                        textCompletion={allTags}
                        autoFocus={newlyAddedTag === tag}
                        autoFocusText={randomTag}
                        onFocus={propertyFocused}
                        onSubmit={(value) => replaceTag(tag, value)}
                     />
                     <div
                        class="removeProperty"
                        on:click={() => removeTag(tag)}
                     >
                        ×
                     </div>
                     <div
                        class="selectIcon"
                        on:click={() => narrowAmassmentToTag(tag)}
                     >
                        must
                     </div>
                     <div
                        class="selectIcon"
                        on:click={() => amassAllWithTag(tag)}
                     >
                        all
                     </div>
                  </div>
               {/each}
               <button on:click={addEmptyProperty}>New property</button>
               {#each inspector.properties as { property, count }}
                  <div class="property">
                     <div class="count">{count}</div>
                     <TextBox
                        text={property.name}
                        textCompletion={allPropertyNames}
                        autoFocus={newlyAddedProperty === property.serialize()}
                        onFocus={propertyFocused}
                        onSubmit={(value) =>
                           replacePropertyName(property, value)}
                     />
                     <TextBox
                        text={property.value}
                        onFocus={propertyFocused}
                        onSubmit={(value) =>
                           replacePropertyValue(property, value)}
                     />
                     <div
                        class="removeProperty"
                        on:click={() => removeProperty(property)}
                     >
                        ×
                     </div>
                     <div
                        class="selectIcon"
                        on:click={() => narrowAmassmentToProperty(property)}
                     >
                        must
                     </div>
                     <div
                        class="selectIcon"
                        on:click={() => amassAllWithProperty(property)}
                     >
                        all
                     </div>
                  </div>
               {/each}
            {/if}
         </div>
      </div>
      <!-- <div class="paneTitle">History</div>
      <div class="historyPane">
         <div>
            {#each history.stack as { description }, i}
               <div
                  class="historyPaneItem {i === history.index
                     ? 'selected'
                     : ''}"
                  on:click={() => executeTimeTravel(i)}
               >
                  {description}
               </div>
            {/each}
         </div>
      </div> -->
      <div class="paneTitle linePaneTitle">Lines</div>
      <div class="linePane">
         {#if lineTypeLoadError}
            <div class="paneMessage">
               Failed to find a "{lineTypeFolderName}" folder within the project
               folder.
            </div>
         {:else if projectFolder || !usingElectron}
            <div class="lineGrid">
               {#each orderedLineTypes as line}
                  <div
                     class="lineGridItem {line.name === lineTypeToUse?.name
                        ? 'toUse'
                        : line.name === selectedLineType?.name
                        ? 'selected'
                        : ''}"
                     on:click={() => {
                        selectedLineType = line
                        boundTool = "draw"
                     }}
                  >
                     <div class="lineName">
                        {line.name}
                     </div>
                     <svg class="lineSvg">
                        <line
                           stroke={line.color}
                           stroke-width={line.thickness}
                           stroke-dasharray={line.dasharray}
                           x1="8"
                           y1="8"
                           x2="1000"
                           y2="8"
                        />
                     </svg>
                  </div>
               {/each}
            </div>
         {:else}
            <div class="paneMessage">
               <p>
                  Similarly, the JSON files for each line type must be placed in
                  a folder named "{lineTypeFolderName}".
               </p>
            </div>
         {/if}
      </div>
      <div class="configPane">
         {#each Object.values(config) as item}
            <div class="configItem" on:click={() => toggleConfig(item)}>
               <div
                  class="configImage"
                  style="background-image: url('{item.icon}')"
               />
               <div>{item.state}</div>
               {#if !grabbedSymbol}
                  <div
                     class="configTooltip"
                     style="left: {mouseInClient.x +
                        8}px; top: {mouseInClient.y + 18}px"
                  >
                     {item.tooltip}
                  </div>
               {/if}
            </div>
         {/each}
      </div>
      <div class="toolbox">
         <div class="toolButtons">
            {#each row1Tools as tool}
               <Button
                  label={labelOfButton(tool)}
                  isSelected={toolToUse === tool}
                  isHeld={heldTool?.tool === tool}
                  isBound={boundTool === tool &&
                     (heldTool === null ||
                        heldTool.tool === tool ||
                        heldTool.shouldBind === false)}
                  on:mousedown={() => {
                     boundTool = tool
                  }}
               />
            {/each}
            {#each row2Tools as tool}
               <Button
                  label={labelOfButton(tool)}
                  isSelected={toolToUse === tool}
                  isHeld={heldTool?.tool === tool}
                  isBound={boundTool === tool &&
                     (heldTool === null ||
                        heldTool.tool === tool ||
                        heldTool.shouldBind === false)}
                  on:mousedown={() => {
                     boundTool = tool
                  }}
               />
            {/each}
         </div>
      </div>
   </div>
   <div
      class="right sidebar"
      on:mouseup={() => {
         grabbedSymbol = null
      }}
   >
      <div class="paneTitle symbolPaneTitle">Symbols</div>
      <div class="symbolPane">
         {#if symbolLoadError}
            <div class="paneMessage">
               Failed to find a "{symbolFolderName}" folder within the project
               folder.
            </div>
         {:else if projectFolder || !usingElectron}
            <div class="symbolGrid">
               {#each [...symbols].sort((a, b) => {
                  return a.fileName < b.fileName ? -1 : 1
               }) as kind}
                  <div
                     class="symbolGridItem"
                     on:mousedown={() => {
                        grabbedSymbol = {
                           kind,
                           // Grab slightly above the center of the symbol. This
                           // position works well when the symbol is rotated.
                           grabOffset: new Vector(
                              (cameraZoom * -kind.svgBox.width()) / 2,
                              (cameraZoom * (-kind.svgBox.height() + 10)) / 2
                           ),
                        }
                     }}
                  >
                     <div class="symbolName">
                        {kind.fileName.replace(".svg", "")}
                     </div>
                     <svg
                        class="symbolImage"
                        viewBox="{kind.svgBox.x.low} {kind.svgBox.y
                           .low} {kind.svgBox.width()} {kind.svgBox.height()}"
                     >
                        <use href="#{kind.fileName}" />
                     </svg>
                  </div>
               {/each}
            </div>
         {:else}
            <div class="paneMessage">
               <p>
                  When you open a project folder, your schematic symbols will be
                  displayed here.
               </p>
               <div class="spacer" />
               <p>
                  The SVG files for each symbol must be placed in a folder named
                  "{symbolFolderName}" within the project folder.
               </p>
            </div>
         {/if}
      </div>
   </div>
   {#if grabbedSymbol}
      <svg
         class="grabbedSymbolImage"
         viewBox="{grabbedSymbol.kind.svgBox.x.low} {grabbedSymbol.kind.svgBox.y
            .low} {grabbedSymbol.kind.svgBox.width()} {grabbedSymbol.kind.svgBox.height()}"
         style="{absolutePosition(
            mouseInClient.displacedBy(grabbedSymbol.grabOffset)
         )}; width: {cameraZoom *
            grabbedSymbol.kind.svgBox.width()}px; height: {cameraZoom *
            grabbedSymbol.kind.svgBox.height()}px;"
      >
         <use href="#{grabbedSymbol.kind.fileName}" /></svg
      >
   {/if}
</div>

<div
   id="symbol templates"
   style="position: absolute; left: 0; top: 0; visibility: hidden; pointer-events: none;"
/>

<style>
   .touchLight {
      color: rgb(60, 240, 255);
   }
   .amassLight {
      color: white;
   }
   .rigidLight {
      color: #0004;
   }
   .freezeLight {
      color: rgb(0, 150, 255);
   }
   .hiddenSymbol {
      fill: rgba(0, 0, 0, 0.15);
   }
   .hiddenSymbol.amassLight {
      fill: rgba(255, 255, 255, 0.5);
   }
   :global(html, body, #app) {
      height: 100%;
      margin: 0;
      overflow: hidden;
   }
   @font-face {
      font-family: "Source Sans";
      src: url("../fonts/SourceSans3VF.ttf.woff2");
      font-weight: 1 1000;
      font-synthesis: none;
   }
   @font-face {
      font-family: "Nunito";
      src: url("../fonts/NunitoVF.ttf");
      font-weight: 1 1000;
      font-synthesis: none;
   }
   :global(html, body, table, tr, td) {
      font-family: "Source Sans";
      font-feature-settings: "cv01"; /* Capital I with serif. */
      font-weight: 390;
      line-height: 1;
   }
   :global(input, button, select, textarea, optgroup, option) {
      font-family: inherit;
      font-size: inherit;
      font-style: inherit;
      font-weight: inherit;
      line-height: inherit;
   }
   :global(.svgTemplate) {
      position: absolute;
      left: 0;
      top: 0;
   }
   div {
      font-size: 15px;
   }
   p {
      margin: 0;
      line-height: 1.2;
   }
   button {
      padding: 2px;
      padding-bottom: 1px;
   }
   .spacer {
      height: 8px;
   }
   .sidebar {
      background-color: rgb(201, 203, 207);
      box-shadow: 0 0 25px 0 rgb(0, 0, 0, 0.12), 0 0 4px 0 rgb(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
   }
   .left.sidebar {
      position: absolute;
      top: 0;
      left: 0;
      width: 250px;
      height: 100%;
   }
   .right.sidebar {
      position: absolute;
      top: 0;
      right: 0;
      width: 180px;
      height: 100%;
   }
   .topThings,
   .linePaneTitle,
   .symbolPaneTitle,
   .configPane {
      box-shadow: 0 1px 3px 0 rgb(0, 0, 0, 0.25);
   }
   .topThings,
   .linePaneTitle,
   .symbolPaneTitle {
      z-index: 1;
   }
   .paneTitle {
      flex-shrink: 0;
      padding: 4px;
      font-size: 16px;
      font-weight: 680;
      background-color: rgb(231, 234, 237);
      user-select: none;
      -webkit-user-select: none;
   }
   .projectPane {
      flex-shrink: 0;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      background-color: rgb(231, 234, 237);
      border-bottom: 1px solid grey;
   }
   .historyPane {
      height: 150px;
      padding: 1px 0;
      overflow-y: scroll;
      display: flex;
      flex-direction: column-reverse; /* keeps scroll bar at bottom of content*/
      user-select: none;
      -webkit-user-select: none;
   }
   .historyPaneItem {
      padding: 3px 5px;
   }
   .historyPaneItem.selected {
      background-color: white;
   }
   .inspectorPane {
      flex-grow: 1;
      max-height: 360px;
      padding: 5px 4px;
      user-select: none;
      -webkit-user-select: none;
      overflow-x: hidden;
      overflow-y: scroll;
   }
   .inspectorItemSummary {
      font-weight: 550;
   }
   .inspectorBody {
      padding: 9px 5px;
      display: flex;
      flex-direction: column;
      gap: 4px;
   }
   .spacer {
      height: 3px;
   }
   .inspectorSubtitle {
      font-weight: 640;
   }
   .rotateButtons {
      display: grid;
      grid-template-rows: 22px;
      grid-template-columns: 22px 22px;
      gap: 3px;
   }
   .rotateButtons,
   .symbolMoveButton {
      filter: drop-shadow(0 1.5px 1.5px rgb(0, 0, 0, 0.6));
   }
   .rotateButton {
      font-size: 24px;
      font-weight: 500;
   }
   .symbolMoveButton {
      font-weight: 500;
      height: 20px;
      line-height: 20px;
      box-sizing: border-box;
   }
   .symbolMoveButton.flip {
      width: 37px;
   }
   .symbolMoveButton.flip.disabled {
      color: grey;
   }
   .flipMessage {
      font-size: 14px;
      line-height: 20px;
   }
   .symbolMoveButton.send,
   .symbolMoveButton.bring {
      width: 96px;
   }
   .rotateButton,
   .symbolMoveButton {
      background-color: rgb(231, 234, 237);
      border-radius: 3px;
      user-select: none;
      -webkit-user-select: none;
      text-align: center;
   }
   .rotateButton:active,
   .symbolMoveButton:active:not(.disabled) {
      box-shadow: 1px 1px 2px 0px #00000077 inset;
      padding-left: 2px;
      padding-top: 1px;
   }
   :global(.glyphSelectionItem.uniqueHighlight),
   .lineGridItem.toUse {
      background-color: white;
   }
   :global(.glyphSelectionItem.multiHighlight),
   .lineGridItem.selected {
      background-color: #999;
   }
   .radioButtons {
      display: flex;
      flex-direction: column;
      align-items: start;
      gap: 3px;
   }
   .tag,
   .property {
      display: flex;
      flex-direction: row;
      gap: 4px;
   }
   .count {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      width: 15px;
   }
   .removeProperty {
      display: flex;
      align-items: center;
      font-size: 22px;
      font-weight: 700;
      color: #444;
   }
   .selectIcon {
      display: flex;
      align-items: center;
      font-weight: 600;
      text-decoration: underline;
   }
   .selectIcon {
   }
   .symbolPane {
      min-height: 100px;
      overflow-x: hidden;
      overflow-y: scroll;
   }
   .paneMessage {
      padding: 5px;
   }
   .symbolGrid {
      display: flex;
      flex-direction: column;
      gap: 1px;
      user-select: none;
      -webkit-user-select: none;
      background-color: rgb(90, 90, 90);
   }
   .symbolGridItem {
      /* height: 80px; */
      padding: 5px;
      background-color: rgb(201, 203, 207);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      font-weight: 400;
   }
   .symbolImage {
      min-height: 20px;
      max-height: 70px;
      max-width: 100%;
      pointer-events: none;
      overflow: visible;
   }
   .grabbedSymbolImage {
      z-index: 10;
      pointer-events: none;
      overflow: visible;
   }
   .linePane {
      min-height: 150px;
      flex-grow: 1;
      padding: 1px 0;
      overflow-x: hidden;
      overflow-y: scroll;
   }
   .lineGrid {
      display: flex;
      flex-direction: column;
      user-select: none;
      -webkit-user-select: none;
   }
   .lineGridItem {
      padding: 4px 5px;
      display: flex;
      flex-direction: row;
      gap: 4px;
      font-weight: 400;
   }
   .lineSvg {
      height: 16px;
      stroke-linecap: round;
   }
   .configPane {
      z-index: 2;
      flex-shrink: 0;
      height: 48px;
      display: flex;
      flex-direction: row;
      user-select: none;
      -webkit-user-select: none;
      background-color: rgb(231, 234, 237);
      border-bottom: 1px solid rgb(156, 156, 156);
   }
   .configItem {
      flex: 1;
      padding: 5px;
      padding-bottom: 2px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      font-weight: 410;
   }
   .configImage {
      flex: 1;
      width: 100%;
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
   }
   .configTooltip {
      position: absolute;
      visibility: hidden;
      pointer-events: none;
   }
   .configItem:hover .configTooltip {
      visibility: visible;
      width: 136px;
      padding: 2px;
      background-color: white;
      box-shadow: 0 0 8px 0 rgb(0, 0, 0, 0.3);
   }
   .toolbox {
      z-index: 1;
      flex-shrink: 0;
      display: flex;
      justify-content: center;
      background-color: rgb(231, 234, 237);
      user-select: none;
      -webkit-user-select: none;
   }
   .toolButtons {
      display: grid;
      grid-template-rows: 53px 53px;
      grid-template-columns: repeat(4, 53px);
      gap: 3px;
      padding: 5px;
      filter: drop-shadow(0 1px 2.5px rgb(0, 0, 0, 0.9));
   }
   .canvas {
      width: 100%;
      height: 100%;
      background-color: rgb(193, 195, 199);
      user-select: none;
      -webkit-user-select: none;
   }
   .cursor-amass {
      cursor: default;
   }
   .cursor-warp {
      cursor: -webkit-image-set(
               url("../cursors/warp 1x.png") 1x,
               url("../cursors/warp 2x.png") 2x
            )
            12 11,
         default;
   }
   .cursor-slide {
      /* cursor: move; */
      cursor: -webkit-image-set(
               url("../cursors/slide 1x.png") 1x,
               url("../cursors/slide 2x.png") 2x
            )
            12 11,
         default;
   }
   .cursor-draw {
      cursor: -webkit-image-set(
               url("../cursors/draw 1x.png") 1x,
               url("../cursors/draw 2x.png") 2x
            )
            10 0,
         default;
   }
   .cursor-erase {
      cursor: -webkit-image-set(
               url("../cursors/erase 1x.png") 1x,
               url("../cursors/erase 2x.png") 2x
            )
            10 1,
         default;
   }
   .cursor-freeze {
      cursor: -webkit-image-set(
               url("../cursors/freeze 1x.png") 1x,
               url("../cursors/freeze 2x.png") 2x
            )
            10 0,
         default;
   }
</style>
