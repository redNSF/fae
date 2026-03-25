# FAE — Figma → After Effects Bridge

Build a three-component system that lets designers push Figma layers directly into Adobe After Effects as native AE layers.

## Architecture

```
[Figma Plugin] ──POST──▶ [Bridge Server :7963] ◀──poll── [AE CEP Panel]
                                                                │
                                                         ExtendScript
                                                                │
                                               Shape / Text / Image / Precomp layers
```

## Setup Instructions

### 1. Bridge Server
- Navigate to `bridge-server/`
- Run `npm install`
- Start the server: `npm start`
- The server runs on `http://localhost:7963`

### 2. Figma Plugin
- Open Figma Desktop App
- Go to **Plugins -> Development -> Import plugin from manifest...**
- Select `figma-plugin/manifest.json`
- Run the **FAE** plugin.

### 3. After Effects CEP Panel
- **macOS:** Run `./install-mac.sh` to install the panel and enable debug mode.
- **Windows:**
  - Copy `ae-panel/` to `C:\Users\<YOU>\AppData\Roaming\Adobe\CEP\extensions\fae\`
  - Enable Debug Mode: Run `reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f` in Command Prompt (Administrator).
- Restart After Effects.
- Open the panel via **Window -> Extensions -> FAE**.

## Features
- **Push Layers:** Select layers in Figma and click "Push to After Effects".
- **Auto-Pull:** The AE panel polls the bridge and automatically builds layers when received.
- **Supported Types:**
  - Rectangles (with corner radius)
  - Ellipses
  - Text (preserves font, size, and color)
  - Images (base64 encoded)
  - Vectors (exported as high-res PNG)
- **Settings:**
  - Precomp Frames
  - Split into separate layers
  - 2x Image export

## License
This project is licensed under the **GNU General Public License v3.0 or later**. See the [LICENSE](LICENSE) file for details.

## Troubleshooting
- **Bridge Offline:** Ensure the Node.js server is running.
- **Panel not showing:** Ensure `PlayerDebugMode` is set to `1` for your AE version's CSXS registry key.
- **Figma connection error:** Ensure the Bridge URL in the plugin UI matches your server address.
