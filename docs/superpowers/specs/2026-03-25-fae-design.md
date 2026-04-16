# FAE — Figma → After Effects Bridge

**Status:** Approved
**Date:** 2026-03-25
**Components:** 3 (Figma Plugin, Bridge Server, AE CEP Panel)

---

## Overview

Build a three-component system that lets designers push Figma layers directly into Adobe After Effects as native AE layers — identical in concept to the "Overlord" plugin by Battleaxe.

---

## Architecture

```
[Figma Plugin] ──POST──▶ [Bridge Server :7963] ◀──poll── [AE CEP Panel]
                                                                │
                                                         ExtendScript
                                                                │
                                               Shape / Text / Image / Precomp layers
```

---

## Component 1: Figma Plugin

**Location:** `figma-plugin/`

### Files
- `manifest.json` — Plugin manifest
- `code.js` — Sandbox code (no DOM access)
- `ui.html` — UI iframe

### manifest.json Requirements
```json
{
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "networkAccess": {
    "allowedDomains": ["localhost:7963"],
    "devAllowedDomains": ["localhost:7963"]
  },
  "name": "FAE",
  "id": "com.fae.figma-plugin"
}
```

**Note:** Domain patterns must not include protocol. Use `localhost:7963` not `http://localhost:7963`.

### code.js — Layer Serialization

Serialize Figma selection into JSON payload sent to UI via `figma.ui.postMessage`.

**Serialized properties per node:**
- `id`, `name`, `type`, `x`, `y`, `width`, `height`
- `rotation` (degrees, CCW in Figma)
- `opacity` (0–1)
- `visible`
- `blendMode`
- `fills[]` — `{ type, opacity, visible, color: {r,g,b} }` for SOLID; include `gradientStops` and `gradientTransform` for gradients
- `strokes[]` + `strokeWeight`
- `cornerRadius` (RECTANGLE)

**Node-specific handling:**
- **TEXT nodes:** `characters`, `fontSize`, `fontName { family, style }`, `textAlignHorizontal`, `textAlignVertical`, `letterSpacing`, `lineHeight`, `textDecoration`, `textCase`
- **IMAGE fills:** Export as PNG at 2× via `node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } })`, base64-encode with `figma.base64Encode()`, set `hasImage = true`, `imageData = <base64>`
- **VECTOR/BOOLEAN_OPERATION nodes:** ExtendScript cannot import SVG. Export as PNG at 2× instead: `node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } })`, set `hasImage = true`, `imageData = <base64>`, `isVector = true`
- **Containers (FRAME, GROUP, COMPONENT, INSTANCE, SECTION):** Recurse into `children`, include `clipsContent`

**Note on vectors:** ExtendScript cannot import SVG files directly. Vector nodes are rasterized to PNG and imported as image layers with the 2× export setting.

**Message types from code.js → ui.html:**
- `{ type: "status", message: string }`
- `{ type: "error", message: string }`
- `{ type: "send-to-bridge", payload: { layers, pageName, timestamp, source: "figma" } }`

**Message types from ui.html → code.js:**
- `{ type: "push-selection", settings: object }`
- `{ type: "close" }`

### ui.html — Panel UI

**Visual design:** Dark UI (`#1e1e1e` background)

**Elements:**
- Status indicator dot (green = connected, yellow = busy, red = error)
- **"Push to After Effects"** primary button (disabled when bridge offline)
- Toggle settings:
  - **Precomp Frames** — wrap Figma frames as AE precomps
  - **Split into separate layers** — each shape gets its own AE layer
  - **2× image export** (on by default)
- Editable server URL input (default `http://localhost:7963`)

**Behavior:**
- On load: `GET /ping` to check bridge status
- On push: `parent.postMessage({ pluginMessage: { type: "push-selection", settings } }, "*")`
- On receiving `send-to-bridge`: `POST /push` with full payload as JSON body

---

## Component 2: Bridge Server

**Location:** `bridge-server/`

### Files
- `package.json` — Package name: `"fae-bridge"`
- `server.js` — Express server

### Dependencies
- `express` `^4.18.2`
- `cors` `^2.8.5`

### server.js

Express server on `127.0.0.1:7963`. Enable CORS for all origins. JSON body limit: `50mb`.

**In-memory state:**
```javascript
let pendingTransfer = null;  // Holds latest Figma push
let lastTransferTime = null;
```

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping` | Health check. Returns `{ status: "ok", version: "1.0.0", pending: bool }` |
| `POST` | `/push` | Receives `{ layers, settings, pageName, timestamp, source }` from Figma plugin. Validates `layers` is an array. Stores as `pendingTransfer`. Returns `{ status: "queued", count: number }` |
| `GET` | `/pull` | Called by AE panel. If `pendingTransfer` is null, returns `{ status: "empty" }`. Otherwise returns and **clears** `pendingTransfer` |
| `DELETE` | `/clear` | Clears pending transfer without consuming. Returns `{ status: "cleared" }` |
| `GET` | `/status` | Debug info: running, port, hasPending, lastTransferTime, layerCount |

**Logging:** Log each push and pull to console with timestamp.

---

## Component 3: After Effects CEP Panel

**Location:** `ae-panel/`

### Files
- `CSXS/manifest.xml` — Extension manifest
- `index.html` — Panel UI
- `js/CSInterface.js` — Downloaded at install time
- `jsx/builder.jsx` — ExtendScript layer builder

### CSXS/manifest.xml

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ExtensionManifest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  ExtensionBundleId="com.fae.panel"
  ExtensionBundleName="FAE"
  Version="1.0.0">
  <ExtensionList>
    <Extension Id="com.fae.panel.main" Version="1.0.0" />
  </ExtensionList>
  <ExecutionEnvironment>
    <HostList>
      <Host Name="AEFT" Version="[17.0,99.9]" />
    </HostList>
    <LocaleList>
      <Locale Code="All" />
    </LocaleList>
    <RequiredRuntimeList>
      <RequiredRuntime Name="CSXS" Version="11.0" />
    </RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.fae.panel.main">
      <DispatchInfo>
        <Resources>
          <MainPath>./index.html</MainPath>
          <ScriptPath>./jsx/builder.jsx</ScriptPath>
        </Resources>
        <Lifecycle>
          <AutoVisible>true</AutoVisible>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>FAE</Menu>
          <Geometry>
            <Size>
              <Width>260</Width>
              <Height>420</Height>
            </Size>
            <MinSize>
              <Width>220</Width>
              <Height>320</Height>
            </MinSize>
          </Geometry>
        </UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>
```

**Notes:**
- AE version `[17.0,99.9]` corresponds to CSXS 11.0 (After Effects 2020+)
- `ScriptPath` must be inside `<Resources>` under `<DispatchInfo>`

### index.html — Panel UI

**Visual design:** Dark theme matching Figma plugin UI

**Elements:**
- Connection status dot + text card
- **"Pull from Figma"** manual button
- Window menu entry: **Window → Extensions → FAE**
- **"Clear"** and **"Clear Log"** utility buttons
- Toggle settings:
  - **Auto-pull on receive** (on by default)
  - **Place in active comp** (off by default)
- Monospace scrollable log panel (timestamped activity)
- Footer showing bridge URL and poll counter

**JavaScript behavior:**
- Instantiate `CSInterface` from `./js/CSInterface.js`
- Poll `GET http://localhost:7963/ping` every **2000ms**
- If `data.pending === true` and `autoPull === true`, immediately call `doPull()`
- `doPull()`: `GET /pull`, receive transfer, call `buildInAE(data)`
- `buildInAE(data)`: Serialize data to JSON, call `csInterface.evalScript("buildFromJSON('" + escapedJSON + "', " + useActiveComp + ")", callback)`
- Parse callback result as JSON: `{ success, layerCount, compName }` or `{ success: false, error }`
- Update status and log panel

### jsx/builder.jsx — ExtendScript Layer Builder

**Entry point:**
```javascript
function buildFromJSON(jsonString, useActiveComp) {
  // Parse JSON, create/select comp, iterate layers
  // Return JSON string: { success: true, layerCount, compName }
  // Or: { success: false, error }
}
```

**Wrap in undo group:**
```javascript
app.beginUndoGroup("FAE: Import");
// ... build logic ...
app.endUndoGroup();
```

#### Comp Creation — `getOrCreateComp(layers, pageName, useActiveComp, project)`
- If `useActiveComp` is true and `app.project.activeItem instanceof CompItem`, use that
- Otherwise create new comp: size from single-layer payload's `width`/`height`, else default 1920×1080
- Name: `pageName + " — " + timestamp`

#### Layer Dispatch — `buildLayer(node, comp, project, settings, compW, compH)`
- Skip if `node.visible === false`
- Route by `node.type`:
  - `FRAME`, `GROUP`, `COMPONENT`, `INSTANCE`, `SECTION` → `buildPrecomp()` if `settings.precomp && type === "FRAME"`, else `buildGroup()`
  - `TEXT` → `buildTextLayer()`
  - `hasImage && imageData` → `buildImageLayer()`
  - Everything else → `buildShapeLayer()`

#### `buildShapeLayer(node, comp, compW, compH)`
- `comp.layers.addShape()`
- Set name, call `setTransform()`, `setOpacity()`, `setBlendMode()`
- Add shape group to `layer.property("Contents")`
- RECTANGLE → `"ADBE Vector Shape - Rect"` with `Size`, `Position [0,0]`, `Roundness` if `cornerRadius`
- ELLIPSE → `"ADBE Vector Shape - Ellipse"` with `Size`, `Position [0,0]`
- Other types → fallback rect placeholder
- After adding shape path, call `addFillsAndStrokes(shapeContents, node)`:
  - SOLID fills → `"ADBE Vector Graphic - Fill"` with `Color [r,g,b,1]` and `Opacity`
  - GRADIENT_LINEAR fills → `"ADBE Vector Graphic - G-Fill"`, type linear, start/end points from node width
  - Strokes (SOLID only, `strokeWeight > 0`) → `"ADBE Vector Graphic - Stroke"` with `Color`, `Stroke Width`, `Opacity`

#### `buildTextLayer(node, comp, compW, compH)`
- `comp.layers.addText(node.characters)`
- `setTransform()`, `setOpacity()`
- Get `layer.property("Source Text").value` as `textDoc`
- Set properties:
  - `font` (`family + "-" + style`)
  - `fontSize`
  - `fillColor` (from first SOLID fill)
  - `justification` (map LEFT/CENTER/RIGHT to `ParagraphJustification`)
  - `tracking` (from `letterSpacing.value`)
  - `leading` (from `lineHeight.value`)
- Apply with `layer.property("Source Text").setValue(textDoc)`

#### `buildImageLayer(node, comp, project, compW, compH)`
- Decode `node.imageData` (base64) to binary
- Write to `Folder.temp.absoluteURI + "/figma_img_" + sanitizedId + ".png"`
- Import via `project.importFile(new ImportOptions(new File(tmpPath)))`
- `comp.layers.add(footage)`
- `setTransform()`, set scale to `[50, 50]` (compensates for 2× Figma export)
- On error: fallback to `comp.layers.addSolid([0.5, 0.5, 0.5], name, w, h, 1)` placeholder

#### `buildGroup(node, comp, project, settings, compW, compH)`
- Recursively build all children (reversed for correct stacking order)
- Add null layer: `comp.layers.addNull()`
- `setTransform()` on null, set `nullLayer.label = 12` (purple)
- Parent all child layers: `child.parent = nullLayer`

#### `buildPrecomp(node, comp, project, settings)`
- `project.items.addComp(node.name, w, h, 1, comp.duration, comp.frameRate)`
- Recurse children into precomp
- `comp.layers.add(precomp)` — position from `node.x + width/2`, `node.y + height/2`

#### Transform Helpers
- `setTransform(layer, node, compW, compH)` — position = `[node.x + width/2, node.y + height/2]`, rotation = `-node.rotation` (Figma is CCW, AE is CW)
- `setOpacity(layer, node)` — `node.opacity * 100`
- `setBlendMode(layer, node)` — map Figma blend mode strings to AE `BlendingMode.*` constants

**Blend mode map:**
```javascript
MULTIPLY, SCREEN, OVERLAY, DARKEN, LIGHTEN, COLOR_DODGE, COLOR_BURN,
HARD_LIGHT, SOFT_LIGHT, DIFFERENCE, EXCLUSION, HUE, SATURATION, COLOR, LUMINOSITY
```

---

## Installation Script — install-mac.sh

Bash script that:
1. Copies `ae-panel/` to `~/Library/Application Support/Adobe/CEP/extensions/fae/`
2. Downloads `CSInterface.js` from `https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js` into `ae-panel/js/`
3. Runs `defaults write com.adobe.CSXS.{9,10,11,12} PlayerDebugMode 1` to allow unsigned extensions
4. Runs `npm install` in `bridge-server/`
5. Prints next-step instructions

---

## README.md Content

**Sections:**
- Architecture diagram (ASCII)
- Setup table (3 components, what each does)
- Step-by-step: start bridge, install Figma plugin, install CEP panel
- Conversion table: Figma layer type → AE layer type
- Settings descriptions
- Troubleshooting section (bridge offline, CEP not showing, font issues)
- How to extend (add shape types, change port)

---

## File Structure

```
fae/
├── README.md
├── install-mac.sh
├── figma-plugin/
│   ├── manifest.json
│   ├── code.js
│   └── ui.html
├── bridge-server/
│   ├── package.json
│   └── server.js
└── ae-panel/
    ├── CSXS/
    │   └── manifest.xml
    ├── js/           ← CSInterface.js (downloaded by install script)
    ├── jsx/
    │   └── builder.jsx
    └── index.html
```

---

## Key Technical Constraints

1. **Figma code.js sandbox:** No DOM, no fetch. All network requests go through `ui.html` via `postMessage`.

2. **ExtendScript (ES3):** No `const`, `let`, arrow functions, template literals, `Array.forEach`, `Promise`, or ES6+. Use `var`, `for` loops, string concatenation only.

3. **Base64 decode in ExtendScript:** Must be manual (no `atob`). Implement lookup-table decoder with `charCodeAt` and `String.fromCharCode`.

4. **CEP panel index.html:** Must load `./js/CSInterface.js` as `<script>` tag before instantiating `new CSInterface()`.

5. **CORS:** Bridge server must allow `origin: "*"` — both Figma plugin iframe and CEP panel HTML are `null`-origin.

6. **JSON escaping:** All JSON passed to `evalScript` must escape single quotes (`'` → `\'`) and newlines (`\n` → `\\n`) before embedding.

7. **Image temp files:** Sanitize `node.id` for filesystem safety (replace non-alphanumeric chars with `_`).

---

## Approval

Design approved by user on 2026-03-25.
