# FAE — Figma ↔ After Effects Bridge

FAE is a three-part system that lets you push selected Figma layers directly into Adobe After Effects — and push AE layers back to Figma — through a local bridge server running on your machine.

---

## Components

| Component | What it is |
|-----------|-----------|
| `figma-plugin/` | Figma plugin — serializes selected layers and sends to bridge |
| `fae-bridge-app/` | Windows tray app (Electron) — local Express server on port 7963 |
| `ae-panel/` | After Effects CEP panel — receives layers from bridge and builds them in AE |

---

## Quick start (development)

### 1. Run the bridge server
```bash
cd fae-bridge-app
npm install
npm start
```
A tray icon appears in the Windows system tray. The bridge listens on `http://127.0.0.1:7963`.

### 2. Install the Figma plugin (dev mode)
1. Open Figma Desktop → **Plugins → Development → Import plugin from manifest**
2. Select `figma-plugin/manifest.json`
3. Run the plugin — select layers → **Push to After Effects**

### 3. Install the AE panel (dev mode)
Copy `ae-panel/` to your CEP extensions folder:
- **Windows**: `%APPDATA%\Roaming\Adobe\CEP\extensions\com.fae.panel\`
- **macOS**: `~/Library/Application Support/Adobe/CEP/extensions/com.fae.panel/`

Enable unsigned extensions (dev only):
```
HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11 → PlayerDebugMode = 1
```

Open After Effects → **Window → Extensions → FAE**

---

## Distribution builds

### Figma plugin — Figma Community
1. Go to [figma.com/developers](https://www.figma.com/developers) → **Create a plugin**
2. Copy the assigned Plugin ID into `figma-plugin/manifest.json` (`"id"` field — currently `TODO_REPLACE_WITH_FIGMA_PLUGIN_ID`)
3. Submit `code.js`, `ui.html`, `manifest.json` plus a 1920×960 cover image and 128×128 icon

### Bridge server — Windows installer
```bash
cd fae-bridge-app
npm install
npm run build:installer
# → build/FAE Bridge Setup 1.0.0.exe
```
The installer is NSIS one-click, per-user, no admin required. Registers auto-startup on first launch.

### AE panel — ZXP
Requires `ZXPSignCmd` on PATH ([download](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD)):
```bash
chmod +x package-zxp.sh
./package-zxp.sh
# → dist/FAE.zxp
```

**User installation:**
1. Download `FAE.zxp`
2. Download **ZXP/UXP Installer** from [aescripts.com](https://aescripts.com/learn/zxp-installer/) (free)
3. Drag `FAE.zxp` into the installer
4. Restart After Effects → **Window → Extensions → FAE**

---

## Bridge API

All endpoints are on `http://127.0.0.1:7963`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping` | Health check — returns `{ status, version, pending }` |
| `POST` | `/push` | Figma → AE: send layer data |
| `GET` | `/pull` | AE panel polls for pending data |
| `POST` | `/push-to-figma` | AE → Figma: send layer data |
| `GET` | `/pull-figma` | Figma plugin polls for AE data |
| `DELETE` | `/clear` | Clear all pending transfers |
| `GET` | `/status` | Debug info |

---

## License

GPL-3.0 — see [LICENSE](LICENSE)
