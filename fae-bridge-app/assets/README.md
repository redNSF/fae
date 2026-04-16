# FAE Bridge — Tray Icon Assets

Place the following PNG files in this directory before building:

| File                   | Size      | Notes                                              |
|------------------------|-----------|----------------------------------------------------|
| `tray-icon.png`        | 32×32 px  | White icon on transparent bg (for dark taskbar)   |
| `tray-icon-active.png` | 32×32 px  | Highlighted orange/blue variant — transfer pending |
| `notification-icon.png`| 64×64 px  | Shown in Windows toast notifications               |

## Design notes
- Use white (#FFFFFF) or light gray icons — Windows taskbar is dark by default
- `tray-icon-active.png` should be visually distinct (e.g. with a colored dot overlay)
- PNG format only — Electron's Tray does not accept ICO on all platforms

## Quick generation (placeholder)
You can generate placeholder icons with any image editor.
A simple white "F→AE" text on transparent background works for development.
