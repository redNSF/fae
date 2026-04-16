# FAE — Figma → After Effects Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-component bridge system that pushes Figma layers directly into Adobe After Effects as native AE layers.

**Architecture:** A Node.js Express bridge server receives layer data from a Figma plugin UI and queues it for an After Effects CEP panel to poll and pull. The AE panel uses ExtendScript to build native shape, text, image, and precomp layers.

**Tech Stack:** JavaScript (Figma plugin), Node.js/Express (bridge), HTML/ExtendScript (CEP panel), ES3-only in .jsx files

**Design Reference:** `docs/superpowers/specs/2026-03-25-fae-design.md`

---

## File Structure Map

```
fae/
├── README.md                               # Project documentation
├── install-mac.sh                          # macOS installation script
├── figma-plugin/
│   ├── manifest.json                       # Figma plugin manifest
│   ├── code.js                             # Sandbox serialization code
│   └── ui.html                             # Plugin UI
├── bridge-server/
│   ├── package.json                        # Node dependencies
│   └── server.js                           # Express bridge server
└── ae-panel/
    ├── CSXS/
    │   └── manifest.xml                    # CEP extension manifest
    ├── js/
    │   └── CSInterface.js                  # Adobe API (downloaded)
    ├── jsx/
    │   └── builder.jsx                     # ExtendScript layer builder
    └── index.html                          # Panel UI
```

---

## Component 1: Bridge Server

The bridge server is the central hub. Build and test this first since both other components depend on it.

### Task 1: Bridge Server — package.json

**Files:**
- Create: `bridge-server/package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "fae-bridge",
  "version": "1.0.0",
  "description": "FAE Bridge Server — Figma to After Effects bridge",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5"
  },
  "keywords": ["figma", "after-effects", "bridge"],
  "author": "",
  "license": "MIT"
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd bridge-server && npm install
```

Expected: `node_modules/` created, express and cors installed.

- [ ] **Step 3: Commit**

```bash
git add bridge-server/package.json bridge-server/package-lock.json
git commit -m "chore: add bridge server package.json with express and cors"
```

---

### Task 2: Bridge Server — Core Server

**Files:**
- Create: `bridge-server/server.js`

- [ ] **Step 1: Implement basic Express server with CORS**

```javascript
var express = require('express');
var cors = require('cors');
var app = express();

var PORT = 7963;
var HOST = '127.0.0.1';

// Enable CORS for all origins (Figma iframe and CEP panel are null-origin)
app.use(cors({ origin: '*' }));

// Parse JSON bodies up to 50mb for large image payloads
app.use(express.json({ limit: '50mb' }));

// In-memory state
var pendingTransfer = null;
var lastTransferTime = null;

// TODO: Add routes in next steps

app.listen(PORT, HOST, function() {
  console.log('FAE Bridge Server');
  console.log('Running on http://' + HOST + ':' + PORT);
});

module.exports = { app, pendingTransfer, lastTransferTime };
```

- [ ] **Step 2: Test server starts**

```bash
cd bridge-server && timeout 3 node server.js || true
```

Expected: Console shows "FAE Bridge Server" and "Running on http://127.0.0.1:7963"

- [ ] **Step 3: Commit**

```bash
git add bridge-server/server.js
git commit -m "feat: add bridge server skeleton with CORS"
```

---

### Task 3: Bridge Server — Health Check Route

**Files:**
- Modify: `bridge-server/server.js`

- [ ] **Step 1: Add GET /ping route before app.listen**

```javascript
// GET /ping — Health check
app.get('/ping', function(req, res) {
  res.json({
    status: 'ok',
    version: '1.0.0',
    pending: pendingTransfer !== null
  });
});
```

- [ ] **Step 2: Test /ping endpoint**

Start server in background:
```bash
cd bridge-server && node server.js &
SERVER_PID=$!
sleep 1
curl -s http://127.0.0.1:7963/ping
kill $SERVER_PID 2>/dev/null
```

Expected: `{"status":"ok","version":"1.0.0","pending":false}`

- [ ] **Step 3: Commit**

```bash
git add bridge-server/server.js
git commit -m "feat: add /ping health check endpoint"
```

---

### Task 4: Bridge Server — Push and Pull Routes

**Files:**
- Modify: `bridge-server/server.js`

- [ ] **Step 1: Add POST /push route**

```javascript
// POST /push — Receive layer data from Figma plugin
app.post('/push', function(req, res) {
  var body = req.body;

  if (!body.layers || !Array.isArray(body.layers)) {
    return res.status(400).json({
      status: 'error',
      message: 'Missing or invalid layers array'
    });
  }

  pendingTransfer = {
    layers: body.layers,
    settings: body.settings || {},
    pageName: body.pageName || 'Untitled',
    timestamp: body.timestamp || Date.now(),
    source: body.source || 'figma'
  };
  lastTransferTime = Date.now();

  console.log('[' + new Date().toISOString() + '] Push received: ' + body.layers.length + ' layers');

  res.json({
    status: 'queued',
    count: body.layers.length
  });
});
```

- [ ] **Step 2: Add GET /pull route**

```javascript
// GET /pull — AE panel polls for pending transfers
app.get('/pull', function(req, res) {
  if (pendingTransfer === null) {
    return res.json({ status: 'empty' });
  }

  var transfer = pendingTransfer;
  pendingTransfer = null;

  console.log('[' + new Date().toISOString() + '] Pull served: ' + transfer.layers.length + ' layers');

  res.json(transfer);
});
```

- [ ] **Step 3: Add DELETE /clear route**

```javascript
// DELETE /clear — Clear pending transfer without consuming
app.delete('/clear', function(req, res) {
  pendingTransfer = null;
  res.json({ status: 'cleared' });
});
```

- [ ] **Step 4: Add GET /status route**

```javascript
// GET /status — Debug information
app.get('/status', function(req, res) {
  res.json({
    running: true,
    port: PORT,
    hasPending: pendingTransfer !== null,
    lastTransferTime: lastTransferTime,
    layerCount: pendingTransfer ? pendingTransfer.layers.length : 0
  });
});
```

- [ ] **Step 5: Test push/pull flow**

```bash
cd bridge-server && node server.js &
SERVER_PID=$!
sleep 1

# Test push
curl -s -X POST http://127.0.0.1:7963/push \
  -H "Content-Type: application/json" \
  -d '{"layers":[{"name":"Test","type":"RECTANGLE"}],"pageName":"TestPage"}'

# Check pending
curl -s http://127.0.0.1:7963/ping

# Test pull
curl -s http://127.0.0.1:7963/pull

# Verify empty after pull
curl -s http://127.0.0.1:7963/pull

kill $SERVER_PID 2>/dev/null
```

Expected:
1. Push returns `{"status":"queued","count":1}`
2. Ping shows `"pending":true`
3. Pull returns the transfer data
4. Second pull returns `{"status":"empty"}`

- [ ] **Step 6: Commit**

```bash
git add bridge-server/server.js
git commit -m "feat: add /push, /pull, /clear, /status endpoints"
```

---

## Component 2: Figma Plugin

The Figma plugin has two parts: code.js (sandboxed, serializes layers) and ui.html (networking UI).

### Task 5: Figma Plugin — Manifest

**Files:**
- Create: `figma-plugin/manifest.json`

- [ ] **Step 1: Create manifest.json**

```json
{
  "api": "1.0.0",
  "editorType": ["figma"],
  "id": "com.fae.figma-plugin",
  "name": "FAE",
  "main": "code.js",
  "ui": "ui.html",
  "networkAccess": {
    "allowedDomains": ["localhost:7963"],
    "devAllowedDomains": ["localhost:7963"]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add figma-plugin/manifest.json
git commit -m "chore: add Figma plugin manifest"
```

---

### Task 6: Figma Plugin — UI Skeleton

**Files:**
- Create: `figma-plugin/ui.html`

- [ ] **Step 1: Create basic HTML structure with dark theme**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FAE</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      background: #1e1e1e;
      color: #e6e6e6;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding: 8px;
      background: #2c2c2c;
      border-radius: 4px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
    }
    .status-dot.connected { background: #4caf50; }
    .status-dot.error { background: #f44336; }
    .status-text { font-weight: 500; }
    button {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 4px;
      background: #0d99ff;
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: #0a8ce0; }
    button:disabled {
      background: #444;
      cursor: not-allowed;
    }
    .settings {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #444;
    }
    .setting {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0;
    }
    input[type="checkbox"] { cursor: pointer; }
    label { cursor: pointer; }
    .server-url {
      margin-top: 16px;
    }
    .server-url input {
      width: 100%;
      padding: 6px;
      border: 1px solid #444;
      border-radius: 4px;
      background: #2c2c2c;
      color: #e6e6e6;
    }
    .message {
      margin-top: 12px;
      padding: 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .message.error { background: #3d1f1f; color: #ff9e9e; }
    .message.success { background: #1f3d1f; color: #9eff9e; }
  </style>
</head>
<body>
  <div class="status">
    <div class="status-dot" id="statusDot"></div>
    <div class="status-text" id="statusText">Checking...</div>
  </div>

  <button id="pushBtn" disabled>Push to After Effects</button>

  <div class="settings">
    <div class="setting">
      <input type="checkbox" id="precompFrames" checked>
      <label for="precompFrames">Precomp Frames</label>
    </div>
    <div class="setting">
      <input type="checkbox" id="splitLayers">
      <label for="splitLayers">Split into separate layers</label>
    </div>
    <div class="setting">
      <input type="checkbox" id="export2x" checked>
      <label for="export2x">2× image export</label>
    </div>
  </div>

  <div class="server-url">
    <label>Bridge URL</label>
    <input type="text" id="serverUrl" value="http://localhost:7963">
  </div>

  <div class="message" id="message"></div>

  <script>
    // TODO: Add JavaScript in next steps
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add figma-plugin/ui.html
git commit -m "feat: add Figma plugin UI skeleton with dark theme"
```

---

### Task 7: Figma Plugin — UI Networking Logic

**Files:**
- Modify: `figma-plugin/ui.html` (add script)

- [ ] **Step 1: Add ping/status checking**

Replace the `<script>// TODO...</script>` with:

```javascript
(function() {
  var serverUrlInput = document.getElementById('serverUrl');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var pushBtn = document.getElementById('pushBtn');
  var messageEl = document.getElementById('message');

  function getServerUrl() {
    return serverUrlInput.value.replace(/\/$/, '');
  }

  function setStatus(state, text) {
    statusDot.className = 'status-dot' + (state ? ' ' + state : '');
    statusText.textContent = text;
    pushBtn.disabled = (state !== 'connected');
  }

  function showMessage(msg, type) {
    messageEl.textContent = msg;
    messageEl.className = 'message' + (type ? ' ' + type : '');
  }

  function checkStatus() {
    var url = getServerUrl() + '/ping';
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'ok') {
          setStatus('connected', 'Connected to bridge');
        } else {
          setStatus('error', 'Bridge error');
        }
      })
      .catch(function(err) {
        setStatus('error', 'Bridge offline');
      });
  }

  // Check status on load and every 3 seconds
  checkStatus();
  setInterval(checkStatus, 3000);

  // Re-check when URL changes
  serverUrlInput.addEventListener('change', checkStatus);

  // TODO: Add push handler
})();
```

- [ ] **Step 2: Add push button handler**

Add before the closing `})();`:

```javascript
  pushBtn.addEventListener('click', function() {
    showMessage('Fetching selection from Figma...', '');

    // Get settings
    var settings = {
      precomp: document.getElementById('precompFrames').checked,
      split: document.getElementById('splitLayers').checked,
      export2x: document.getElementById('export2x').checked
    };

    // Request data from code.js
    parent.postMessage({
      pluginMessage: {
        type: 'push-selection',
        settings: settings
      }
    }, '*');
  });

  // Listen for data from code.js
  window.onmessage = function(event) {
    var msg = event.data.pluginMessage;
    if (!msg) return;

    if (msg.type === 'send-to-bridge') {
      showMessage('Sending to bridge...', '');

      var url = getServerUrl() + '/push';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg.payload)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'queued') {
          showMessage('Sent ' + data.count + ' layer(s) to After Effects', 'success');
        } else {
          showMessage('Error: ' + (data.message || 'Unknown error'), 'error');
        }
      })
      .catch(function(err) {
        showMessage('Error sending to bridge: ' + err.message, 'error');
      });
    } else if (msg.type === 'status') {
      showMessage(msg.message, '');
    } else if (msg.type === 'error') {
      showMessage(msg.message, 'error');
    }
  };
```

- [ ] **Step 3: Commit**

```bash
git add figma-plugin/ui.html
git commit -m "feat: add UI networking logic for ping and push"
```

---

### Task 8: Figma Plugin — Sandbox Code (code.js)

**Files:**
- Create: `figma-plugin/code.js`

- [ ] **Step 1: Implement basic message handling**

```javascript
// FAE Plugin — code.js (sandboxed)
// Handles layer serialization and communication with ui.html

figma.showUI(__html__, { width: 280, height: 420 });

// Listen for messages from UI
figma.ui.onmessage = function(msg) {
  if (msg.type === 'push-selection') {
    handlePushSelection(msg.settings);
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// TODO: Implement serialization in next steps
```

- [ ] **Step 2: Add serialization helpers**

Add before the closing brace:

```javascript
// Serialize a Figma node to JSON-safe object
function serializeNode(node, settings) {
  var data = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    blendMode: node.blendMode
  };

  // Serialize fills
  if (node.fills && node.fills !== figma.mixed) {
    data.fills = node.fills.map(function(fill) {
      var f = {
        type: fill.type,
        opacity: fill.opacity,
        visible: fill.visible
      };
      if (fill.type === 'SOLID' && fill.color) {
        f.color = {
          r: Math.round(fill.color.r * 255),
          g: Math.round(fill.color.g * 255),
          b: Math.round(fill.color.b * 255)
        };
      } else if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops) {
        f.gradientStops = fill.gradientStops;
        f.gradientTransform = fill.gradientTransform;
      }
      return f;
    });
  }

  // Serialize strokes
  if (node.strokes && node.strokes !== figma.mixed) {
    data.strokes = node.strokes.map(function(stroke) {
      return {
        type: stroke.type,
        color: stroke.color ? {
          r: Math.round(stroke.color.r * 255),
          g: Math.round(stroke.color.g * 255),
          b: Math.round(stroke.color.b * 255)
        } : null
      };
    });
    data.strokeWeight = node.strokeWeight;
  }

  // Corner radius for rectangles
  if (node.type === 'RECTANGLE' && node.topLeftRadius !== undefined) {
    data.cornerRadius = node.topLeftRadius;
  }

  // Text-specific properties
  if (node.type === 'TEXT') {
    data.characters = node.characters;
    data.fontSize = node.fontSize;
    if (node.fontName && node.fontName !== figma.mixed) {
      data.fontName = {
        family: node.fontName.family,
        style: node.fontName.style
      };
    }
    data.textAlignHorizontal = node.textAlignHorizontal;
    data.textAlignVertical = node.textAlignVertical;
    if (node.letterSpacing && node.letterSpacing !== figma.mixed) {
      data.letterSpacing = node.letterSpacing;
    }
    if (node.lineHeight && node.lineHeight !== figma.mixed) {
      data.lineHeight = node.lineHeight;
    }
    data.textDecoration = node.textDecoration;
    data.textCase = node.textCase;
  }

  // Container children
  if (node.children) {
    data.children = node.children.map(function(child) {
      return serializeNode(child, settings);
    });
    if (node.clipsContent !== undefined) {
      data.clipsContent = node.clipsContent;
    }
  }

  return data;
}

// Check if node has image fills
function hasImageFill(node) {
  if (!node.fills || node.fills === figma.mixed) return false;
  return node.fills.some(function(fill) {
    return fill.type === 'IMAGE';
  });
}

// Export node as base64 PNG
async function exportNodeAsImage(node, settings) {
  try {
    var scale = settings.export2x ? 2 : 1;
    var bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    });
    return figma.base64Encode(bytes);
  } catch (err) {
    console.error('Export failed for ' + node.name + ':', err);
    return null;
  }
}
```

- [ ] **Step 3: Add main push handler with async image export**

Add before the closing brace:

```javascript
// Handle push-selection message from UI
async function handlePushSelection(settings) {
  var selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No layers selected in Figma'
    });
    return;
  }

  figma.ui.postMessage({
    type: 'status',
    message: 'Serializing ' + selection.length + ' layer(s)...'
  });

  // Serialize all selected nodes
  var layers = [];
  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    var data = serializeNode(node, settings);

    // Export images and vectors as PNG
    if (settings.export2x !== false) {
      // Export anything with image fills
      if (hasImageFill(node)) {
        var imageData = await exportNodeAsImage(node, settings);
        if (imageData) {
          data.hasImage = true;
          data.imageData = imageData;
        }
      }
      // Export vectors as PNG (ExtendScript can't import SVG)
      if (['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'].indexOf(node.type) !== -1) {
        var vectorData = await exportNodeAsImage(node, settings);
        if (vectorData) {
          data.hasImage = true;
          data.imageData = vectorData;
          data.isVector = true;
        }
      }
    }

    layers.push(data);
  }

  // Send to UI for forwarding to bridge
  figma.ui.postMessage({
    type: 'send-to-bridge',
    payload: {
      layers: layers,
      settings: settings,
      pageName: figma.root.name,
      timestamp: Date.now(),
      source: 'figma'
    }
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add figma-plugin/code.js
git commit -m "feat: add Figma layer serialization with image export"
```

---

## Component 3: AE CEP Panel

The CEP panel has three files: manifest.xml, index.html (UI), and builder.jsx (ExtendScript).

### Task 9: AE Panel — CEP Manifest

**Files:**
- Create: `ae-panel/CSXS/manifest.xml`

- [ ] **Step 1: Create directory and manifest.xml**

```bash
mkdir -p ae-panel/CSXS
```

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ExtensionManifest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  Version="11.0"
  ExtensionBundleId="com.fae.panel"
  ExtensionBundleName="FAE"
  ExtensionBundleVersion="1.0.0">

  <ExtensionList>
    <Extension Id="com.fae.panel.main" Version="1.0.0"/>
  </ExtensionList>

  <ExecutionEnvironment>
    <HostList>
      <Host Name="AEFT" Version="[17.0,99.9]"/>
    </HostList>
    <LocaleList>
      <Locale Code="All"/>
    </LocaleList>
    <RequiredRuntimeList>
      <RequiredRuntime Name="CSXS" Version="11.0"/>
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

- [ ] **Step 2: Commit**

```bash
git add ae-panel/CSXS/manifest.xml
git commit -m "chore: add AE CEP panel manifest"
```

---

### Task 10: AE Panel — Panel UI (index.html)

**Files:**
- Create: `ae-panel/index.html`

- [ ] **Step 1: Create HTML structure with dark theme**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FAE</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      background: #1e1e1e;
      color: #e6e6e6;
      overflow-x: hidden;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding: 8px;
      background: #2c2c2c;
      border-radius: 4px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
    }
    .status-dot.connected { background: #4caf50; }
    .status-dot.pending { background: #ff9800; }
    .status-dot.error { background: #f44336; }
    .status-text { font-weight: 500; }
    button {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 4px;
      background: #0d99ff;
      color: white;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 8px;
    }
    button:hover:not(:disabled) { background: #0a8ce0; }
    button:disabled {
      background: #444;
      cursor: not-allowed;
    }
    button.secondary {
      background: #444;
    }
    button.secondary:hover:not(:disabled) { background: #555; }
    .buttons-row {
      display: flex;
      gap: 8px;
    }
    .buttons-row button {
      flex: 1;
    }
    .settings {
      margin: 12px 0;
      padding: 12px 0;
      border-top: 1px solid #444;
      border-bottom: 1px solid #444;
    }
    .setting {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 6px 0;
    }
    input[type="checkbox"] { cursor: pointer; }
    label { cursor: pointer; }
    .log {
      margin-top: 12px;
      padding: 8px;
      background: #151515;
      border: 1px solid #333;
      border-radius: 4px;
      font-family: "SF Mono", Monaco, monospace;
      font-size: 10px;
      height: 140px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .log-entry { margin: 2px 0; }
    .log-entry.error { color: #ff6b6b; }
    .log-entry.success { color: #69db7c; }
    .log-entry.info { color: #74c0fc; }
    .footer {
      margin-top: 8px;
      font-size: 10px;
      color: #888;
      text-align: center;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="status">
    <div class="status-dot" id="statusDot"></div>
    <div class="status-text" id="statusText">Connecting...</div>
  </div>

  <button id="pullBtn">Pull from Figma</button>

  <div class="buttons-row">
    <button id="clearBtn" class="secondary">Clear</button>
    <button id="clearLogBtn" class="secondary">Clear Log</button>
  </div>

  <div class="settings">
    <div class="setting">
      <input type="checkbox" id="autoPull" checked>
      <label for="autoPull">Auto-pull on receive</label>
    </div>
    <div class="setting">
      <input type="checkbox" id="useActiveComp">
      <label for="useActiveComp">Place in active comp</label>
    </div>
  </div>

  <div class="log" id="logPanel">Ready...</div>

  <div class="footer">
    Bridge: <span id="bridgeUrl">localhost:7963</span> | Poll: <span id="pollCount">0</span>
  </div>

  <script src="./js/CSInterface.js"></script>
  <script>
    // TODO: Add JavaScript in next steps
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add ae-panel/index.html
git commit -m "feat: add AE panel UI with dark theme"
```

---

### Task 11: AE Panel — JavaScript Logic

**Files:**
- Modify: `ae-panel/index.html` (add script)

- [ ] **Step 1: Replace TODO script with initialization**

```javascript
(function() {
  var csInterface = new CSInterface();
  var serverUrl = 'http://localhost:7963';
  var pollInterval = 2000;
  var pollCount = 0;

  // UI elements
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var pullBtn = document.getElementById('pullBtn');
  var clearBtn = document.getElementById('clearBtn');
  var clearLogBtn = document.getElementById('clearLogBtn');
  var logPanel = document.getElementById('logPanel');
  var autoPullCheckbox = document.getElementById('autoPull');
  var useActiveCompCheckbox = document.getElementById('useActiveComp');
  var pollCountEl = document.getElementById('pollCount');

  function log(message, type) {
    var entry = document.createElement('div');
    entry.className = 'log-entry' + (type ? ' ' + type : '');
    var time = new Date().toLocaleTimeString();
    entry.textContent = '[' + time + '] ' + message;
    logPanel.appendChild(entry);
    logPanel.scrollTop = logPanel.scrollHeight;
  }

  function setStatus(state, text) {
    statusDot.className = 'status-dot' + (state ? ' ' + state : '');
    statusText.textContent = text;
    pullBtn.disabled = (state === 'error');
  }

  function checkBridge() {
    pollCount++;
    pollCountEl.textContent = pollCount;

    fetch(serverUrl + '/ping')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'ok') {
          if (data.pending) {
            setStatus('pending', 'Transfer ready');
            if (autoPullCheckbox.checked) {
              doPull();
            }
          } else {
            setStatus('connected', 'Connected');
          }
        } else {
          setStatus('error', 'Bridge error');
        }
      })
      .catch(function(err) {
        setStatus('error', 'Bridge offline');
      });
  }

  function doPull() {
    log('Pulling from bridge...', 'info');

    fetch(serverUrl + '/pull')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'empty') {
          log('No pending transfer', 'info');
          return;
        }

        log('Received ' + data.layers.length + ' layer(s)', 'success');
        buildInAE(data);
      })
      .catch(function(err) {
        log('Pull failed: ' + err.message, 'error');
      });
  }

  function buildInAE(data) {
    var useActiveComp = useActiveCompCheckbox.checked;
    var jsonStr = JSON.stringify(data);

    // Escape for ExtendScript — escape single quotes and newlines
    var escapedJSON = jsonStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

    var script = 'buildFromJSON(\'' + escapedJSON + '\', ' + useActiveComp + ')';

    csInterface.evalScript(script, function(result) {
      try {
        var res = JSON.parse(result);
        if (res.success) {
          log('Created ' + res.layerCount + ' layer(s) in "' + res.compName + '"', 'success');
        } else {
          log('Error: ' + res.error, 'error');
        }
      } catch (e) {
        log('ExtendScript error: ' + result, 'error');
      }
    });
  }

  // Event listeners
  pullBtn.addEventListener('click', doPull);

  clearBtn.addEventListener('click', function() {
    fetch(serverUrl + '/clear', { method: 'DELETE' })
      .then(function() { log('Transfer cleared', 'info'); })
      .catch(function(err) { log('Clear failed: ' + err.message, 'error'); });
  });

  clearLogBtn.addEventListener('click', function() {
    logPanel.innerHTML = '';
    log('Log cleared', 'info');
  });

  // Start polling
  log('FAE Panel initialized', 'info');
  checkBridge();
  setInterval(checkBridge, pollInterval);
})();
```

- [ ] **Step 2: Commit**

```bash
git add ae-panel/index.html
git commit -m "feat: add AE panel networking and polling logic"
```

---

### Task 12: AE Panel — ExtendScript Builder (builder.jsx)

**Files:**
- Create: `ae-panel/jsx/builder.jsx`

- [ ] **Step 1: Create file with ES3-compatible header**

```javascript
// FAE ExtendScript Layer Builder
// ES3 ONLY — no const, let, arrow functions, or ES6 features

// Entry point called from CEP panel
function buildFromJSON(jsonString, useActiveComp) {
  app.beginUndoGroup("FAE: Import");

  var result;
  try {
    var data = JSON.parse(jsonString);
    var project = app.project;

    if (!project) {
      throw new Error("No After Effects project open");
    }

    var comp = getOrCreateComp(data.layers, data.pageName, useActiveComp, project);
    var compW = comp.width;
    var compH = comp.height;

    var layerCount = 0;
    for (var i = 0; i < data.layers.length; i++) {
      layerCount += buildLayer(data.layers[i], comp, project, data.settings, compW, compH);
    }

    result = JSON.stringify({
      success: true,
      layerCount: layerCount,
      compName: comp.name
    });
  } catch (err) {
    result = JSON.stringify({
      success: false,
      error: err.message
    });
  }

  app.endUndoGroup();
  return result;
}

// TODO: Add helper functions
```

- [ ] **Step 2: Add comp creation and layer dispatch**

Add before the closing brace at end of file:

```javascript
// Get or create composition
function getOrCreateComp(layers, pageName, useActiveComp, project) {
  // Try to use active comp if requested
  if (useActiveComp && app.project.activeItem instanceof CompItem) {
    return app.project.activeItem;
  }

  // Calculate comp size from layers
  var w = 1920, h = 1080;
  if (layers && layers.length > 0) {
    var maxW = 0, maxH = 0;
    for (var i = 0; i < layers.length; i++) {
      var right = layers[i].x + layers[i].width;
      var bottom = layers[i].y + layers[i].height;
      if (right > maxW) maxW = right;
      if (bottom > maxH) maxH = bottom;
    }
    if (maxW > 0) w = Math.min(Math.ceil(maxW), 16384);
    if (maxH > 0) h = Math.min(Math.ceil(maxH), 16384);
  }

  var name = pageName + " — " + new Date().toLocaleTimeString();
  return project.items.addComp(name, w, h, 1, 30, 30);
}

// Build a layer and return count of layers created
function buildLayer(node, comp, project, settings, compW, compH) {
  if (!node.visible) return 0;

  var type = node.type;

  // Route by type
  if (type === "TEXT") {
    buildTextLayer(node, comp, compW, compH);
    return 1;
  }

  if (node.hasImage && node.imageData) {
    buildImageLayer(node, comp, project, compW, compH);
    return 1;
  }

  if (type === "FRAME" && settings.precomp) {
    buildPrecomp(node, comp, project, settings);
    return 1;
  }

  if (type === "FRAME" || type === "GROUP" || type === "COMPONENT" ||
      type === "INSTANCE" || type === "SECTION") {
    return buildGroup(node, comp, project, settings, compW, compH);
  }

  // Default: shape layer
  buildShapeLayer(node, comp, compW, compH);
  return 1;
}
```

- [ ] **Step 3: Add transform helpers and shape layer builder**

Add before the closing brace:

```javascript
// Set transform properties
function setTransform(layer, node, compW, compH) {
  layer.position.setValue([node.x + node.width / 2, node.y + node.height / 2]);
  // Figma rotation is CCW, AE is CW
  layer.rotation.setValue(-node.rotation);
}

function setOpacity(layer, node) {
  if (node.opacity !== undefined) {
    layer.opacity.setValue(node.opacity * 100);
  }
}

// Build shape layer (rectangles, ellipses)
function buildShapeLayer(node, comp, compW, compH) {
  var layer = comp.layers.addShape();
  layer.name = node.name;

  setTransform(layer, node, compW, compH);
  setOpacity(layer, node);

  var contents = layer.property("Contents");
  var shapeGroup = contents.addProperty("ADBE Vector Group");

  // Add shape path based on type
  if (node.type === "RECTANGLE") {
    var rect = shapeGroup.addProperty("ADBE Vector Shape - Rect");
    rect.property("Size").setValue([node.width, node.height]);
    rect.property("Position").setValue([0, 0]);
    if (node.cornerRadius > 0) {
      rect.property("Roundness").setValue(node.cornerRadius);
    }
  } else if (node.type === "ELLIPSE" || node.type === "OVAL") {
    var ellipse = shapeGroup.addProperty("ADBE Vector Shape - Ellipse");
    ellipse.property("Size").setValue([node.width, node.height]);
    ellipse.property("Position").setValue([0, 0]);
  } else {
    // Fallback: rectangle placeholder
    var fallback = shapeGroup.addProperty("ADBE Vector Shape - Rect");
    fallback.property("Size").setValue([node.width, node.height]);
    fallback.property("Position").setValue([0, 0]);
  }

  // Add fills and strokes
  addFillsAndStrokes(shapeGroup, node);
}

// Add fills and strokes to shape group
function addFillsAndStrokes(shapeGroup, node) {
  // Add fills
  if (node.fills && node.fills.length > 0) {
    for (var i = 0; i < node.fills.length; i++) {
      var fill = node.fills[i];
      if (!fill.visible) continue;

      if (fill.type === "SOLID" && fill.color) {
        var fillProp = shapeGroup.addProperty("ADBE Vector Graphic - Fill");
        fillProp.property("Color").setValue([
          fill.color.r / 255,
          fill.color.g / 255,
          fill.color.b / 255
        ]);
        if (fill.opacity !== undefined) {
          fillProp.property("Opacity").setValue(fill.opacity * 100);
        }
      }
    }
  }

  // Add strokes
  if (node.strokes && node.strokes.length > 0 && node.strokeWeight > 0) {
    for (var j = 0; j < node.strokes.length; j++) {
      var stroke = node.strokes[j];
      if (stroke.type === "SOLID" && stroke.color) {
        var strokeProp = shapeGroup.addProperty("ADBE Vector Graphic - Stroke");
        strokeProp.property("Color").setValue([
          stroke.color.r / 255,
          stroke.color.g / 255,
          stroke.color.b / 255
        ]);
        strokeProp.property("Stroke Width").setValue(node.strokeWeight);
      }
    }
  }
}
```

- [ ] **Step 4: Add text and image layer builders**

Add before the closing brace:

```javascript
// Build text layer
function buildTextLayer(node, comp, compW, compH) {
  var layer = comp.layers.addText(node.characters || "Text");
  layer.name = node.name;

  setTransform(layer, node, compW, compH);
  setOpacity(layer, node);

  var textProp = layer.property("Source Text");
  var textDoc = textProp.value;

  // Set font
  if (node.fontName && node.fontName.family) {
    var style = node.fontName.style || "Regular";
    textDoc.font = node.fontName.family + "-" + style;
  }

  if (node.fontSize) {
    textDoc.fontSize = node.fontSize;
  }

  // Set fill color from first solid fill
  if (node.fills && node.fills.length > 0) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].type === "SOLID" && node.fills[i].color) {
        textDoc.fillColor = [
          node.fills[i].color.r / 255,
          node.fills[i].color.g / 255,
          node.fills[i].color.b / 255
        ];
        break;
      }
    }
  }

  // Set justification
  if (node.textAlignHorizontal) {
    var alignMap = {
      "LEFT": ParagraphJustification.LEFT_JUSTIFY,
      "CENTER": ParagraphJustification.CENTER_JUSTIFY,
      "RIGHT": ParagraphJustification.RIGHT_JUSTIFY
    };
    if (alignMap[node.textAlignHorizontal]) {
      textDoc.justification = alignMap[node.textAlignHorizontal];
    }
  }

  // Set tracking
  if (node.letterSpacing && node.letterSpacing.value) {
    textDoc.tracking = node.letterSpacing.value;
  }

  // Set leading
  if (node.lineHeight && node.lineHeight.value) {
    textDoc.leading = node.lineHeight.value;
  }

  textProp.setValue(textDoc);
}

// Base64 decode helper (ExtendScript has no atob)
function base64Decode(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = [];
  var enc1, enc2, enc3, enc4;
  var i = 0;
  input = input.replace(/[^A-Za-z0-9+/=]/g, "");

  while (i < input.length) {
    enc1 = chars.indexOf(input.charAt(i++));
    enc2 = chars.indexOf(input.charAt(i++));
    enc3 = chars.indexOf(input.charAt(i++));
    enc4 = chars.indexOf(input.charAt(i++));

    output.push(String.fromCharCode((enc1 << 2) | (enc2 >> 4)));
    if (enc3 !== -1) {
      output.push(String.fromCharCode(((enc2 & 15) << 4) | (enc3 >> 2)));
    }
    if (enc4 !== -1) {
      output.push(String.fromCharCode(((enc3 & 3) << 6) | enc4));
    }
  }

  return output.join("");
}

// Sanitize ID for filesystem
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

// Build image layer
function buildImageLayer(node, comp, project, compW, compH) {
  try {
    // Decode base64 and write to temp file
    var binaryData = base64Decode(node.imageData);
    var tmpFile = Folder.temp.absoluteURI + "/figma_img_" + sanitizeId(node.id) + ".png";
    var file = new File(tmpFile);

    file.encoding = "BINARY";
    file.open("w");
    file.write(binaryData);
    file.close();

    // Import the file
    var importOpts = new ImportOptions(new File(tmpFile));
    var footage = project.importFile(importOpts);

    // Add to comp
    var layer = comp.layers.add(footage);
    layer.name = node.name;

    setTransform(layer, node, compW, compH);

    // Scale down 50% if it was 2x export
    layer.scale.setValue([50, 50]);

  } catch (err) {
    // Fallback: gray solid
    var layer = comp.layers.addSolid(
      [0.5, 0.5, 0.5],
      node.name,
      node.width || 100,
      node.height || 100,
      1
    );
    setTransform(layer, node, compW, compH);
  }
}
```

- [ ] **Step 5: Add group and precomp builders**

Add before the closing brace:

```javascript
// Build group — creates null and parents children
function buildGroup(node, comp, project, settings, compW, compH) {
  if (!node.children || node.children.length === 0) return 0;

  // Build children in reverse order (bottom to top in Figma = top to bottom in AE)
  var childCount = 0;
  for (var i = node.children.length - 1; i >= 0; i--) {
    childCount += buildLayer(node.children[i], comp, project, settings, compW, compH);
  }

  // Create null layer as parent
  var nullLayer = comp.layers.addNull();
  nullLayer.name = node.name;
  setTransform(nullLayer, node, compW, compH);
  nullLayer.label = 12; // Purple label for nulls

  // Parent children to null
  for (var j = 1; j <= childCount && j <= comp.layers.length; j++) {
    if (comp.layer(j) !== nullLayer) {
      comp.layer(j).parent = nullLayer;
    }
  }

  return childCount + 1;
}

// Build precomp — creates nested composition
function buildPrecomp(node, comp, project, settings) {
  if (!node.children || node.children.length === 0) {
    // Empty frame: just create a shape
    buildShapeLayer(node, comp, comp.width, comp.height);
    return;
  }

  // Create precomp
  var precomp = project.items.addComp(
    node.name,
    Math.ceil(node.width),
    Math.ceil(node.height),
    1,
    comp.duration,
    comp.frameRate
  );

  // Build children into precomp
  for (var i = node.children.length - 1; i >= 0; i--) {
    buildLayer(node.children[i], precomp, project, settings, precomp.width, precomp.height);
  }

  // Add precomp to main comp
  var layer = comp.layers.add(precomp);
  layer.name = node.name;
  layer.position.setValue([node.x + node.width / 2, node.y + node.height / 2]);
}
```

- [ ] **Step 6: Commit**

```bash
git add ae-panel/jsx/builder.jsx
git commit -m "feat: add ExtendScript layer builder with all layer types"
```

---

## Component 4: Installation & Documentation

### Task 13: Installation Script

**Files:**
- Create: `install-mac.sh`

- [ ] **Step 1: Create macOS installation script**

```bash
#!/bin/bash
# FAE Installation Script for macOS

set -e

echo "========================================"
echo "FAE — Figma → After Effects Bridge"
echo "Installation Script"
echo "========================================"
echo ""

# Configuration
EXTENSION_NAME="fae"
EXTENSION_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXTENSION_NAME"
CSI_INTERFACE_URL="https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js"

# Check if running from correct directory
if [ ! -d "ae-panel" ] || [ ! -d "bridge-server" ]; then
    echo "Error: Please run this script from the fae project root"
    exit 1
fi

echo "Step 1/5: Creating extension directory..."
mkdir -p "$EXTENSION_DIR"

echo "Step 2/5: Copying AE panel files..."
cp -R ae-panel/* "$EXTENSION_DIR/"

echo "Step 3/5: Downloading CSInterface.js..."
mkdir -p "$EXTENSION_DIR/js"
curl -sL "$CSI_INTERFACE_URL" -o "$EXTENSION_DIR/js/CSInterface.js"

if [ ! -f "$EXTENSION_DIR/js/CSInterface.js" ]; then
    echo "Error: Failed to download CSInterface.js"
    exit 1
fi

echo "Step 4/5: Enabling debug mode for CEP..."
for version in 9 10 11 12; do
    defaults write com.adobe.CSXS.$version PlayerDebugMode 1 2>/dev/null || true
done

echo "Step 5/5: Installing bridge server dependencies..."
cd bridge-server && npm install

echo ""
echo "========================================"
echo "Installation Complete!"
echo "========================================"
echo ""
echo "Next Steps:"
echo "1. Start the bridge server:"
echo "   cd bridge-server && node server.js"
echo ""
echo "2. Load the Figma plugin:"
echo "   - In Figma: Plugins → Development → Import plugin from manifest"
echo "   - Select: figma-plugin/manifest.json"
echo ""
echo "3. Open After Effects and load the panel:"
echo "   - Window → Extensions → FAE"
echo ""
echo "4. Select layers in Figma and click 'Push to After Effects'"
echo ""
echo "Troubleshooting:"
echo "- If CEP panel doesn't appear, restart After Effects"
echo "- Check Console in After Effects for errors (Help → Log...)"
echo "- Verify bridge server is running on port 7963"
echo ""
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x install-mac.sh
git add install-mac.sh
git commit -m "chore: add macOS installation script"
```

---

### Task 14: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create comprehensive README**

```markdown
# FAE — Figma → After Effects Bridge

Push Figma layers directly into Adobe After Effects as native AE layers. Inspired by Battleaxe's "Overlord" plugin.

## Architecture

```
[Figma Plugin] ──POST──▶ [Bridge Server :7963] ◀──poll── [AE CEP Panel]
                                                                │
                                                         ExtendScript
                                                                │
                                               Shape / Text / Image / Precomp layers
```

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Figma Plugin** | `figma-plugin/` | Serializes selected layers and pushes to bridge |
| **Bridge Server** | `bridge-server/` | Express server queuing transfers between Figma and AE |
| **AE CEP Panel** | `ae-panel/` | Polls bridge and builds native AE layers via ExtendScript |

## Quick Start

### 1. Install

**macOS:**
```bash
./install-mac.sh
```

**Manual (any platform):**
1. Copy `ae-panel/` to your CEP extensions folder:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/fae/`
   - Windows: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\fae\`

2. Download [CSInterface.js](https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js) to `ae-panel/js/`

3. Enable CEP debug mode (see Troubleshooting)

4. Install bridge dependencies:
   ```bash
   cd bridge-server && npm install
   ```

### 2. Start Bridge Server

```bash
cd bridge-server
node server.js
```

Keep this running in a terminal window.

### 3. Load Figma Plugin

In Figma Desktop:
1. Plugins → Development → Import plugin from manifest
2. Select `figma-plugin/manifest.json`

### 4. Open AE Panel

In After Effects:
1. Window → Extensions → FAE
2. The panel will connect to the bridge automatically

### 5. Transfer Layers

1. Select layers in Figma
2. Click **"Push to After Effects"** in the Figma plugin
3. The AE panel auto-pulls and builds the layers (or click **"Pull from Figma"**)

## Layer Type Mapping

| Figma Layer | After Effects Layer |
|-------------|---------------------|
| Frame (with Precomp setting) | Precomp |
| Frame, Group, Component | Null + children |
| Rectangle | Shape Layer (Rectangle path) |
| Ellipse/Oval | Shape Layer (Ellipse path) |
| Text | Text Layer |
| Vector (any) | Image Layer (PNG rasterized) |
| Image fills | Image Layer |

## Settings

### Figma Plugin
- **Precomp Frames** — Wrap Figma frames as AE precomps
- **Split into separate layers** — Each shape gets its own AE layer
- **2× image export** — Export images at 2× resolution for better quality

### AE Panel
- **Auto-pull on receive** — Automatically import when data arrives (default: on)
- **Place in active comp** — Add to currently open comp instead of creating new

## Troubleshooting

### Bridge Server Issues

**"Bridge offline" in Figma plugin:**
- Verify server is running: `curl http://localhost:7963/ping`
- Check firewall isn't blocking port 7963
- Ensure you're using `127.0.0.1:7963` not `localhost:7963` (some systems resolve differently)

### CEP Panel Not Showing

**Panel doesn't appear in Window → Extensions:**
- Restart After Effects
- Enable debug mode:
  ```bash
  defaults write com.adobe.CSXS.11 PlayerDebugMode 1  # macOS
  ```
- Check CSInterface.js exists in `ae-panel/js/`
- Verify manifest.xml syntax is valid

**Extension loads but shows blank:**
- Open Chrome DevTools for CEP (add `-debug` to AE shortcut or use CEF client)
- Check console for JavaScript errors

### Font Issues

**Text layers show wrong font:**
- After Effects must have the exact font installed
- Font names must match exactly (e.g., "Inter-Bold" not "Inter Bold")
- Check After Effects Character panel for available fonts

### Layer Issues

**Shapes appear but colors are wrong:**
- ExtendScript uses 0-1 range for RGB, Figma uses 0-255
- Conversion is handled automatically, verify fills are SOLID type

**Images don't appear:**
- Vector layers are rasterized to PNG (ExtendScript can't import SVG)
- Check temp folder permissions for image export
- Verify base64 decoding succeeded

## Extending

### Add New Shape Types

Edit `ae-panel/jsx/builder.jsx`:
1. Add case in `buildShapeLayer()` for new `node.type`
2. Use `ADBE Vector Shape` properties as needed
3. Reference [After Effects Scripting Guide](https://ae-scripting.docsforadobe.dev/)

### Change Bridge Port

1. Edit `bridge-server/server.js` — change `PORT` constant
2. Edit `figma-plugin/ui.html` — update default server URL
3. Edit `ae-panel/index.html` — update `serverUrl` variable

## Technical Notes

- **Figma Sandbox:** `code.js` has no DOM/network access. All HTTP goes through `ui.html` via `postMessage`.
- **ExtendScript ES3:** `.jsx` files must use ES3 only — no `const`, `let`, arrow functions, or modern array methods.
- **CORS:** Bridge server allows all origins because Figma iframe and CEP panel are `null`-origin.
- **Base64:** ExtendScript has no `atob()` — manual decoder implemented in `builder.jsx`.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with setup and troubleshooting"
```

---

## Verification

### Task 15: Final Verification

- [ ] **Step 1: Verify all files exist**

```bash
ls -la figma-plugin/
ls -la bridge-server/
ls -la ae-panel/
ls -la ae-panel/CSXS/
ls -la ae-panel/jsx/
```

Expected: All files present (manifest.json, code.js, ui.html, package.json, server.js, manifest.xml, index.html, builder.jsx)

- [ ] **Step 2: Test bridge server**

```bash
cd bridge-server && node server.js &
sleep 2
curl -s http://127.0.0.1:7963/ping
echo ""
kill %1 2>/dev/null || true
```

Expected: `{"status":"ok","version":"1.0.0","pending":false}`

- [ ] **Step 3: Commit final state**

```bash
git add -A
git commit -m "feat: complete FAE implementation — Figma to After Effects bridge"
```

---

## Implementation Complete

All components are implemented:
- ✅ Bridge Server — Express server with CORS, all REST endpoints
- ✅ Figma Plugin — Manifest, sandbox code.js, networking UI
- ✅ AE CEP Panel — Manifest, panel HTML/JS, ExtendScript builder
- ✅ Installation — macOS install script
- ✅ Documentation — Comprehensive README

**Next:** Test end-to-end by running the bridge, loading both plugins, and transferring layers.
