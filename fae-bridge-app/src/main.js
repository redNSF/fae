/**
 * FAE Bridge — Electron Main Process
 * Tray-only background app. Never shows a window.
 */

const { app, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');

// ── Constants ────────────────────────────────────────────────────────────────
const VERSION = '1.0.0';
const PORT = 7963;
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ── State ────────────────────────────────────────────────────────────────────
let tray = null;
let httpServer = null;
let serverRunning = false;
let logPath = '';

// ── Paths (safe after packaging) ─────────────────────────────────────────────
function assetPath(name) {
  // In production, extraResources lands next to the app root
  const packed = path.join(process.resourcesPath, 'assets', name);
  const dev    = path.join(__dirname, '..', 'assets', name);
  return fs.existsSync(packed) ? packed : dev;
}

// ── Logging ──────────────────────────────────────────────────────────────────
function initLog() {
  logPath = path.join(app.getPath('userData'), 'fae-bridge.log');
}

function writeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    // Rotate if > 5 MB
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      if (stat.size > LOG_MAX_BYTES) {
        const content = fs.readFileSync(logPath, 'utf8').split('\n');
        const trimmed = content.slice(-1000).join('\n');
        fs.writeFileSync(logPath, trimmed, 'utf8');
      }
    }
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (e) {
    // Silently ignore log write failures
  }
}

// ── Tray menu builder ─────────────────────────────────────────────────────────
function buildMenu() {
  const { openAtLogin } = app.getLoginItemSettings();

  return Menu.buildFromTemplate([
    {
      label: `FAE Bridge v${VERSION}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: serverRunning
        ? `● Running on port ${PORT}`
        : '○ Server stopped',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Start on Windows startup',
      type: 'checkbox',
      checked: openAtLogin,
      click(item) {
        toggleStartup(item.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Open Log File',
      click() {
        shell.openPath(logPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Stop Server',
      enabled: serverRunning,
      click() {
        stopServer();
      }
    },
    {
      label: 'Start Server',
      enabled: !serverRunning,
      click() {
        doStartServer();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit FAE Bridge',
      click() {
        app.quit();
      }
    }
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(
    serverRunning
      ? `FAE Bridge — Running on port ${PORT}`
      : 'FAE Bridge — Stopped'
  );
}

// ── Startup toggle ────────────────────────────────────────────────────────────
function toggleStartup(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
  writeLog(`Auto-startup ${enabled ? 'enabled' : 'disabled'}`);
  refreshTray();
}

// ── Server lifecycle ──────────────────────────────────────────────────────────
function doStartServer() {
  if (serverRunning) return;

  try {
    httpServer = startServer(onTransferReceived, writeLog);
    serverRunning = true;
    writeLog(`Server started on http://127.0.0.1:${PORT}`);
    refreshTray();
    setTrayIcon('normal');
  } catch (err) {
    writeLog(`Failed to start server: ${err.message}`);
    serverRunning = false;
    refreshTray();
  }
}

function stopServer() {
  if (!httpServer || !serverRunning) return;

  httpServer.close(() => {
    writeLog('Server stopped.');
    serverRunning = false;
    httpServer = null;
    refreshTray();
    setTrayIcon('normal');
  });
}

// ── Transfer notification ─────────────────────────────────────────────────────
function onTransferReceived(transfer) {
  const count = transfer && transfer.layers ? transfer.layers.length : '?';
  writeLog(`Transfer received: ${count} layer(s)`);

  // Switch to active icon
  setTrayIcon('active');

  if (Notification.isSupported()) {
    new Notification({
      title: 'FAE',
      body: `${count} layer(s) ready in After Effects`,
      icon: assetPath('notification-icon.png')
    }).show();
  }

  // Revert icon after 4 s
  setTimeout(() => setTrayIcon('normal'), 4000);
}

// ── Tray icon helper ──────────────────────────────────────────────────────────
function setTrayIcon(state) {
  if (!tray) return;
  const iconFile = state === 'active' ? 'tray-icon-active.png' : 'tray-icon.png';
  const img = nativeImage.createFromPath(assetPath(iconFile));
  tray.setImage(img);
}

// ── App bootstrap ─────────────────────────────────────────────────────────────

// Required for Windows toast notifications
app.setAppUserModelId('com.fae.bridge');

// Tray-only — hide from taskbar / dock
app.on('ready', () => {
  initLog();
  writeLog('FAE Bridge starting…');

  // Enable auto-startup on first launch (flag file prevents re-setting)
  const firstLaunchFlag = path.join(app.getPath('userData'), '.first-launch-done');
  if (!fs.existsSync(firstLaunchFlag)) {
    app.setLoginItemSettings({ openAtLogin: true });
    fs.writeFileSync(firstLaunchFlag, '1');
    writeLog('First launch — auto-startup registered.');
  }

  // Build tray
  const iconImg = nativeImage.createFromPath(assetPath('tray-icon.png'));
  tray = new Tray(iconImg);
  tray.setToolTip('FAE Bridge');

  // Left-click also opens context menu (Windows-friendly)
  tray.on('click', () => {
    tray.popUpContextMenu(buildMenu());
  });

  // Start Express server
  doStartServer();
  refreshTray();
});

// Prevent the app from closing when all windows are closed (there are none, but just in case)
app.on('window-all-closed', (e) => {
  // Do nothing — tray keeps the app alive
});

// Clean shutdown
app.on('before-quit', () => {
  writeLog('FAE Bridge shutting down…');
  stopServer();
});
