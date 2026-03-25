/*
 * FAE — Figma to After Effects Bridge
 * Copyright (C) 2026 Riyad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

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

// GET /ping — Health check
app.get('/ping', function(req, res) {
  res.json({
    status: 'ok',
    version: '1.0.0',
    pending: pendingTransfer !== null
  });
});

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

// DELETE /clear — Clear pending transfer without consuming
app.delete('/clear', function(req, res) {
  pendingTransfer = null;
  res.json({ status: 'cleared' });
});

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

app.listen(PORT, HOST, function() {
  console.log('FAE Bridge Server');
  console.log('Running on http://' + HOST + ':' + PORT);
});

module.exports = { app, pendingTransfer, lastTransferTime };
