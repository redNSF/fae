/**
 * FAE Bridge — Express server module
 * Exported as startServer(onPush, log) so Electron main can control lifecycle.
 */

const express = require('express');
const cors    = require('cors');
const http    = require('http');

const PORT = 7963;
const HOST = '127.0.0.1';

let pendingTransfer      = null;
let pendingFigmaTransfer = null;
let lastTransferTime     = null;

function startServer(onPush, log) {
  const _log = (msg) => { if (typeof log === 'function') log(msg); };

  const expressApp = express();
  expressApp.use(cors({ origin: '*' }));
  expressApp.use(express.json({ limit: '50mb' }));

  // ── GET /ping ─────────────────────────────────────────────────────────────
  expressApp.get('/ping', (req, res) => {
    res.json({
      status:  'ok',
      version: '1.0.0',
      pending: pendingTransfer !== null
    });
  });

  // ── POST /push — Figma → AE ───────────────────────────────────────────────
  expressApp.post('/push', (req, res) => {
    const body = req.body;

    if (!body.layers || !Array.isArray(body.layers)) {
      return res.status(400).json({ status: 'error', message: 'Missing or invalid layers array' });
    }

    pendingTransfer = {
      layers:    body.layers,
      settings:  body.settings  || {},
      pageName:  body.pageName  || 'Untitled',
      timestamp: body.timestamp || Date.now(),
      source:    body.source    || 'figma'
    };
    lastTransferTime = Date.now();

    _log(`Push received: ${body.layers.length} layers`);

    // Notify Electron main process
    if (typeof onPush === 'function') onPush(pendingTransfer);

    res.json({ status: 'queued', count: body.layers.length });
  });

  // ── GET /pull — AE panel polls ────────────────────────────────────────────
  expressApp.get('/pull', (req, res) => {
    if (pendingTransfer === null) {
      return res.json({ status: 'empty' });
    }
    const transfer  = pendingTransfer;
    pendingTransfer = null;
    _log(`Pull served: ${transfer.layers.length} layers`);
    res.json(transfer);
  });

  // ── POST /push-to-figma — AE → Figma ─────────────────────────────────────
  expressApp.post('/push-to-figma', (req, res) => {
    const body = req.body;

    if (!body.layers || !Array.isArray(body.layers)) {
      return res.status(400).json({ status: 'error', message: 'Missing or invalid layers array' });
    }

    pendingFigmaTransfer = {
      layers:    body.layers,
      timestamp: Date.now()
    };

    _log(`AE Push received: ${body.layers.length} layers`);
    res.json({ status: 'queued', count: body.layers.length });
  });

  // ── GET /pull-figma — Figma plugin polls ──────────────────────────────────
  expressApp.get('/pull-figma', (req, res) => {
    if (pendingFigmaTransfer === null) {
      return res.json({ status: 'empty' });
    }
    const transfer       = pendingFigmaTransfer;
    pendingFigmaTransfer = null;
    _log(`Figma Pull served: ${transfer.layers.length} layers`);
    res.json(transfer);
  });

  // ── DELETE /clear ─────────────────────────────────────────────────────────
  expressApp.delete('/clear', (req, res) => {
    pendingTransfer      = null;
    pendingFigmaTransfer = null;
    _log('Transfer queue cleared.');
    res.json({ status: 'cleared' });
  });

  // ── GET /status — debug ───────────────────────────────────────────────────
  expressApp.get('/status', (req, res) => {
    res.json({
      running:          true,
      port:             PORT,
      hasPending:       pendingTransfer      !== null,
      hasFigmaPending:  pendingFigmaTransfer !== null,
      lastTransferTime: lastTransferTime,
      layerCount:       pendingTransfer ? pendingTransfer.layers.length : 0
    });
  });

  // ── Start http.Server and return it so Electron can call .close() ─────────
  const server = http.createServer(expressApp);
  server.listen(PORT, HOST, () => {
    _log(`FAE Bridge running on http://${HOST}:${PORT}`);
  });

  server.on('error', (err) => {
    _log(`Server error: ${err.message}`);
  });

  return server;
}

module.exports = { startServer };
