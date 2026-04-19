/*
 * FAE — Figma ↔ After Effects Bridge (Standalone Script)
 * Copyright (C) 2026 Riyad Shuvro
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * USAGE: File → Scripts → Run Script File → FAE.jsx
 *        (Or place in AE's Scripts/ScriptUI Panels folder to dock as a panel)
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSON Polyfill (ExtendScript is ES3)
// ─────────────────────────────────────────────────────────────────────────────
if (typeof JSON !== "object") { JSON = {}; }
if (typeof JSON.stringify !== "function") {
  JSON.stringify = function (obj) {
    var t = typeof obj;
    if (t !== "object" || obj === null) {
      if (t === "string") return '"' + obj.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r') + '"';
      return String(obj);
    }
    var arr = (obj && obj.constructor === Array);
    var json = [];
    for (var n in obj) {
      if (!obj.hasOwnProperty(n)) continue;
      var v = obj[n]; var vt = typeof v;
      var val;
      if (vt === "string") val = JSON.stringify(v);
      else if (vt === "object" && v !== null) val = JSON.stringify(v);
      else if (vt === "boolean" || vt === "number") val = String(v);
      else continue;
      json.push((arr ? "" : ('"' + n + '":')) + val);
    }
    return (arr ? "[" : "{") + json.join(",") + (arr ? "]" : "}");
  };
}
if (typeof JSON.parse !== "function") {
  JSON.parse = function (str) { return eval("(" + str + ")"); };
}
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (item) {
    for (var i = 0; i < this.length; i++) { if (this[i] === item) return i; }
    return -1;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP via ExtendScript Socket (no CEP / no browser needed)
// ─────────────────────────────────────────────────────────────────────────────
var BRIDGE_HOST = "127.0.0.1";
var BRIDGE_PORT = 7963;

function httpRequest(method, path, body) {
  var s = new Socket();
  s.encoding = "binary";
  if (!s.open(BRIDGE_HOST + ":" + BRIDGE_PORT, "binary")) {
    return { ok: false, body: null, error: "Cannot connect to bridge at " + BRIDGE_HOST + ":" + BRIDGE_PORT };
  }

  var contentType = "application/json";
  var bodyStr = (body !== undefined && body !== null) ? JSON.stringify(body) : "";
  var req  = method + " " + path + " HTTP/1.0\r\n";
      req += "Host: " + BRIDGE_HOST + ":" + BRIDGE_PORT + "\r\n";
      req += "Content-Type: " + contentType + "\r\n";
      req += "Content-Length: " + bodyStr.length + "\r\n";
      req += "Connection: close\r\n";
      req += "\r\n";
      req += bodyStr;

  s.write(req);

  var resp = "";
  while (!s.eof) { resp += s.read(1024); }
  s.close();

  // Parse HTTP response: split headers/body on blank line
  var sep = resp.indexOf("\r\n\r\n");
  if (sep === -1) sep = resp.indexOf("\n\n");
  if (sep === -1) return { ok: false, body: null, error: "Bad HTTP response" };

  var headerPart = resp.substring(0, sep);
  var bodyPart   = resp.substring(sep + (resp.charAt(sep + 2) === "\n" ? 2 : 4));

  // Read status code from first line
  var firstLine = headerPart.split("\n")[0];
  var statusMatch = firstLine.match(/HTTP\/\S+\s+(\d+)/);
  var statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
  var ok = (statusCode >= 200 && statusCode < 300);

  var parsed = null;
  try { parsed = JSON.parse(bodyPart); } catch (e) { parsed = bodyPart; }

  return { ok: ok, body: parsed, error: ok ? null : ("HTTP " + statusCode) };
}

function bridgePing()        { return httpRequest("GET",    "/ping",         null); }
function bridgePull()        { return httpRequest("GET",    "/pull",         null); }
function bridgeClear()       { return httpRequest("DELETE", "/clear",        null); }
function bridgePushToFigma(layers) { return httpRequest("POST", "/push-to-figma", { layers: layers }); }

// ─────────────────────────────────────────────────────────────────────────────
// Layer Builder (identical logic to ae-panel/jsx/builder.jsx)
// ─────────────────────────────────────────────────────────────────────────────
function buildFromData(data, useActiveComp) {
  if (!data || !data.layers) return { success: false, error: "Invalid data: no layers array" };

  app.beginUndoGroup("FAE: Import");
  try {
    var project = app.project;
    var comp = getOrCreateComp(data, useActiveComp, project);
    var count = 0;
    var settings = data.settings || {};

    for (var i = data.layers.length - 1; i >= 0; i--) {
      try {
        if (buildLayer(data.layers[i], comp, project, settings, null)) count++;
      } catch (err) { /* skip bad layers */ }
    }

    app.endUndoGroup();
    return { success: true, layerCount: count, compName: comp.name };
  } catch (err) {
    try { app.endUndoGroup(); } catch(e) {}
    return { success: false, error: err.toString() };
  }
}

function getOrCreateComp(data, useActiveComp, project) {
  if (useActiveComp && project.activeItem instanceof CompItem) return project.activeItem;
  var w = 1920, h = 1080;
  if (data.layers.length > 0) { w = Math.round(data.layers[0].width) || 1920; h = Math.round(data.layers[0].height) || 1080; }
  var name = (data.pageName || "Figma Import") + " " + formatDate(new Date());
  return project.items.addComp(name, w, h, 1, 30, 24);
}

function buildLayer(node, comp, project, settings, parentLayer) {
  if (node.visible === false) return false;
  var layer;
  if (node.hasImage && node.imageData) {
    layer = buildImageLayer(node, comp, project, settings);
  } else if (node.type === "TEXT") {
    layer = buildTextLayer(node, comp);
  } else if (node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    if (node.type === "COMPONENT" || (settings.precomp && node.type === "FRAME")) {
      layer = buildPrecomp(node, comp, project, settings);
    } else {
      layer = buildGroup(node, comp, project, settings);
    }
  } else {
    layer = buildShapeLayer(node, comp);
  }
  if (layer) {
    if (parentLayer) layer.parent = parentLayer;
    setBasicTransform(layer, node, comp, parentLayer);
    if (node.effects && node.effects.length > 0) applyEffects(layer, node.effects);
    return true;
  }
  return false;
}

function applyEffects(layer, effects) {
  for (var i = 0; i < effects.length; i++) {
    var effect = effects[i];
    if (effect.visible === false) continue;
    var fxProp = layer.property("Effects");
    if (!fxProp) continue;
    if (effect.type === "DROP_SHADOW") {
      var ds = fxProp.addProperty("ADBE Drop Shadow");
      if (ds) {
        if (effect.color) {
          ds.property("Shadow Color").setValue([effect.color.r, effect.color.g, effect.color.b]);
          if (effect.color.a !== undefined) ds.property("Opacity").setValue(effect.color.a * 255);
        }
        if (effect.offset) {
          var y = effect.offset.y, x = effect.offset.x;
          ds.property("Direction").setValue(Math.atan2(y, x) * 180 / Math.PI);
          ds.property("Distance").setValue(Math.sqrt(x*x + y*y));
        }
        if (effect.radius !== undefined) ds.property("Softness").setValue(effect.radius);
      }
    } else if (effect.type === "LAYER_BLUR") {
      var blur = fxProp.addProperty("ADBE Gaussian Blur 2");
      if (blur && effect.radius !== undefined) blur.property("Blurriness").setValue(effect.radius);
    } else if (effect.type === "INNER_SHADOW") {
      fxProp.addProperty("ADBE Inner Shadow");
    }
  }
}

function buildShapeLayer(node, comp) {
  var layer = comp.layers.addShape();
  layer.name = node.name;
  var contents = layer.property("Contents");
  var group = contents.addProperty("ADBE Vector Group");
  group.name = node.name;

  if (node.vectorPaths && node.vectorPaths.length > 0) {
    for (var i = 0; i < node.vectorPaths.length; i++) {
      var parsed = parseSVGPath(node.vectorPaths[i].data);
      var pathGroup = group.property("Contents").addProperty("ADBE Vector Shape - Group");
      var shape = new Shape();
      var hw = (node.width || 0) / 2, hh = (node.height || 0) / 2;
      var verts = [];
      for (var v = 0; v < parsed.vertices.length; v++) {
        verts.push([parsed.vertices[v][0] - hw, parsed.vertices[v][1] - hh]);
      }
      shape.vertices = verts;
      shape.inTangents = parsed.inTangents;
      shape.outTangents = parsed.outTangents;
      shape.closed = parsed.closed;
      pathGroup.property("Path").setValue(shape);
    }
  } else if (node.type === "RECTANGLE") {
    var rg = group.property("Contents").addProperty("ADBE Vector Shape - Rect");
    rg.property("Size").setValue([node.width, node.height]);
    if (node.cornerRadius) rg.property("Roundness").setValue(node.cornerRadius);
  } else if (node.type === "ELLIPSE") {
    var eg = group.property("Contents").addProperty("ADBE Vector Shape - Ellipse");
    eg.property("Size").setValue([node.width, node.height]);
  } else {
    var fg = group.property("Contents").addProperty("ADBE Vector Shape - Rect");
    fg.property("Size").setValue([node.width || 100, node.height || 100]);
  }

  addFillsAndStrokes(group.property("Contents"), node);
  return layer;
}

function addFillsAndStrokes(contents, node) {
  if (node.fills && node.fills.length > 0) {
    for (var i = 0; i < node.fills.length; i++) {
      var fill = node.fills[i];
      if (fill.visible === false) continue;
      if (fill.type === "SOLID") {
        var f = contents.addProperty("ADBE Vector Graphic - Fill");
        f.property("Color").setValue([fill.color.r/255, fill.color.g/255, fill.color.b/255, 1]);
        f.property("Opacity").setValue((fill.opacity || 1) * 100);
      }
    }
  }
  if (node.strokes && node.strokes.length > 0 && node.strokeWeight > 0) {
    for (var i = 0; i < node.strokes.length; i++) {
      var stroke = node.strokes[i];
      if (stroke.type === "SOLID" && stroke.color) {
        var st = contents.addProperty("ADBE Vector Graphic - Stroke");
        st.property("Color").setValue([stroke.color.r/255, stroke.color.g/255, stroke.color.b/255, 1]);
        st.property("Stroke Width").setValue(node.strokeWeight);
      }
    }
  }
}

function buildTextLayer(node, comp) {
  var layer = comp.layers.addText(node.characters);
  layer.name = node.name;
  var textProp = layer.property("Source Text");
  var textDoc = textProp.value;

  if (node.styledSegments && node.styledSegments.length > 0) {
    if (typeof textDoc.characterRange !== "undefined") {
      for (var i = 0; i < node.styledSegments.length; i++) {
        var seg = node.styledSegments[i];
        var rangeLength = seg.end - seg.start;
        if (rangeLength > 0) {
          var cr = textDoc.characterRange(seg.start, rangeLength);
          if (seg.fontSize) cr.fontSize = seg.fontSize;
          if (seg.fontName) cr.font = seg.fontName.family + "-" + seg.fontName.style;
          if (seg.color) cr.fillColor = [seg.color.r/255, seg.color.g/255, seg.color.b/255];
        }
      }
      textProp.setValue(textDoc);
    } else {
      var baseSeg = node.styledSegments[0];
      if (baseSeg.fontSize) textDoc.fontSize = baseSeg.fontSize;
      if (baseSeg.fontName) textDoc.font = baseSeg.fontName.family + "-" + baseSeg.fontName.style;
      if (baseSeg.color) textDoc.fillColor = [baseSeg.color.r/255, baseSeg.color.g/255, baseSeg.color.b/255];
      textProp.setValue(textDoc);
    }
  } else {
    if (node.fontSize) textDoc.fontSize = node.fontSize;
    if (node.fontName) textDoc.font = node.fontName.family + "-" + node.fontName.style;
    if (node.fills && node.fills.length > 0 && node.fills[0].type === "SOLID") {
      textDoc.fillColor = [node.fills[0].color.r/255, node.fills[0].color.g/255, node.fills[0].color.b/255];
    }
    textProp.setValue(textDoc);
  }
  return layer;
}

function buildImageLayer(node, comp, project, settings) {
  var folder = new Folder(Folder.temp.absoluteURI + "/fae_images");
  if (!folder.exists) folder.create();
  var sanitizedId = node.id.replace(/[^a-z0-9]/gi, "_");
  var tempPath = folder.absoluteURI + "/img_" + sanitizedId + ".png";
  var file = new File(tempPath);
  file.encoding = "BINARY";
  file.open("w");
  file.write(decodeBase64ToBinary(node.imageData));
  file.close();
  try {
    var footage = project.importFile(new ImportOptions(file));
    var layer = comp.layers.add(footage);
    layer.name = node.name;
    var scaleVal = (settings && settings.export2x) ? 50 : 100;
    layer.property("Scale").setValue([scaleVal, scaleVal, 100]);
    return layer;
  } catch (err) {
    return comp.layers.addSolid([0.5, 0.5, 0.5], node.name, Math.round(node.width) || 100, Math.round(node.height) || 100, 1);
  }
}

function buildGroup(node, comp, project, settings) {
  var nullLayer = comp.layers.addNull();
  nullLayer.name = "[ " + node.name + " ]";
  nullLayer.label = 12;
  var childLayers = [];
  if (node.children) {
    for (var i = node.children.length - 1; i >= 0; i--) {
      var countBefore = comp.numLayers;
      buildLayer(node.children[i], comp, project, settings, nullLayer);
      var countAfter = comp.numLayers;
      if (countAfter > countBefore) {
        for (var idx = 1; idx <= countAfter - countBefore; idx++) childLayers.push(comp.layer(idx));
      }
    }
  }
  if (node.clipsContent === true && childLayers.length > 0) {
    var matte = comp.layers.addSolid([1, 1, 1], node.name + " Matte",
      Math.max(1, Math.round(node.width || 100)), Math.max(1, Math.round(node.height || 100)), 1);
    matte.property("Position").setValue([(node.x || 0) + (node.width || 100)/2, (node.y || 0) + (node.height || 100)/2]);
    matte.enabled = false;
    for (var k = 0; k < childLayers.length; k++) {
      var tl = childLayers[k];
      if (typeof tl.setTrackMatte !== "undefined") {
        tl.setTrackMatte(matte, TrackMatteType.ALPHA);
      } else if (k === childLayers.length - 1) {
        matte.moveBefore(tl);
        tl.trackMatteType = TrackMatteType.ALPHA;
        break;
      }
    }
  }
  return nullLayer;
}

function buildPrecomp(node, comp, project, settings) {
  var precomp = project.items.addComp(node.name, Math.round(node.width || 100), Math.round(node.height || 100),
    1, comp.duration || 10, comp.frameRate || 30);
  precomp.comment = (node.type === "COMPONENT") ? node.id : node.mainComponentId;
  if (node.children) {
    for (var i = node.children.length - 1; i >= 0; i--) buildLayer(node.children[i], precomp, project, settings, null);
  }
  var layer = comp.layers.add(precomp);
  layer.name = node.name;
  return layer;
}

function setBasicTransform(layer, node, comp, parentLayer) {
  var w = node.width || 100, h = node.height || 100;
  if (layer instanceof ShapeLayer || layer instanceof TextLayer || layer instanceof AVLayer) {
    layer.property("Anchor Point").setValue([w/2, h/2]);
  }
  var x = (node.x || 0) + w/2, y = (node.y || 0) + h/2;
  layer.property("Position").setValue([x, y]);
  if (node.rotation) layer.property("Rotation").setValue(-node.rotation);
  if (node.opacity !== undefined) layer.property("Opacity").setValue(node.opacity * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read AE Selection → push to Figma
// ─────────────────────────────────────────────────────────────────────────────
function readSelection() {
  if (!app.project.activeItem || !(app.project.activeItem instanceof CompItem))
    return { success: false, error: "No active comp." };
  var comp = app.project.activeItem;
  var selected = comp.selectedLayers;
  if (selected.length === 0) return { success: false, error: "No layers selected." };

  var layersData = [];
  for (var i = 0; i < selected.length; i++) {
    var layer = selected[i];
    var tf = layer.property("Transform");
    var data = {
      name: layer.name,
      type: "UNKNOWN",
      x: tf.property("Position").value[0],
      y: tf.property("Position").value[1],
      rotation: tf.property("Rotation").value,
      opacity: tf.property("Opacity").value / 100,
      scaleX: tf.property("Scale").value[0] / 100,
      scaleY: tf.property("Scale").value[1] / 100,
      visible: layer.enabled
    };
    var ap = tf.property("Anchor Point").value;
    data.anchorX = ap[0]; data.anchorY = ap[1];

    if (layer instanceof ShapeLayer) {
      data.type = "SHAPE";
      data.fills = []; data.strokes = []; data.paths = [];
      extractShapeData(layer.property("Contents"), data.fills, data.strokes, data.paths);
      try { var r = layer.sourceRectAtTime(comp.time, false); data.width = r.width; data.height = r.height; } catch(e) {}
    } else if (layer instanceof TextLayer) {
      data.type = "TEXT";
      var td = layer.property("Source Text").value;
      data.characters = td.text; data.fontSize = td.fontSize; data.fontName = td.font;
      if (td.fillColor) data.fillColor = { r: td.fillColor[0], g: td.fillColor[1], b: td.fillColor[2] };
      try { var r = layer.sourceRectAtTime(comp.time, false); data.width = r.width; data.height = r.height; } catch(e) {}
    } else if (layer instanceof AVLayer) {
      data.type = (layer.source instanceof CompItem) ? "PRECOMP" : "AVLAYER";
      data.width = layer.width; data.height = layer.height;
    }
    layersData.push(data);
  }
  return { success: true, layers: layersData };
}

function extractShapeData(propGroup, outFills, outStrokes, outPaths) {
  for (var i = 1; i <= propGroup.numProperties; i++) {
    var prop = propGroup.property(i);
    if (!prop) continue;
    if (prop.matchName === "ADBE Vector Graphic - Fill" && prop.enabled) {
      var col = prop.property("Color").value;
      outFills.push({ r: col[0], g: col[1], b: col[2], a: prop.property("Opacity").value / 100 });
    } else if (prop.matchName === "ADBE Vector Graphic - Stroke" && prop.enabled) {
      var col = prop.property("Color").value;
      outStrokes.push({ r: col[0], g: col[1], b: col[2], a: prop.property("Opacity").value / 100, weight: prop.property("Stroke Width").value });
    } else if (prop.matchName === "ADBE Vector Shape - Group") {
      try {
        var pathObj = prop.property("Path").value;
        outPaths.push({ vertices: pathObj.vertices, inTangents: pathObj.inTangents, outTangents: pathObj.outTangents, closed: pathObj.closed });
      } catch(e) {}
    } else if (prop.propertyType === PropertyType.PROPERTY_GROUP || prop.propertyType === PropertyType.INDEXED_GROUP) {
      extractShapeData(prop, outFills, outStrokes, outPaths);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function formatDate(date) {
  return date.getFullYear() + "-" + (date.getMonth()+1) + "-" + date.getDate()
    + " " + date.getHours() + ":" + (date.getMinutes() < 10 ? "0" : "") + date.getMinutes();
}

function decodeBase64ToBinary(s) {
  var lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var buffer = "", i = 0;
  while (i < s.length) {
    var c1 = lookup.indexOf(s.charAt(i++));
    var c2 = lookup.indexOf(s.charAt(i++));
    var char3 = s.charAt(i++), char4 = s.charAt(i++);
    var c3 = lookup.indexOf(char3), c4 = lookup.indexOf(char4);
    buffer += String.fromCharCode((c1 << 2) | (c2 >> 4));
    if (char3 !== "=" && c3 !== -1) buffer += String.fromCharCode(((c2 & 15) << 4) | (c3 >> 2));
    if (char4 !== "=" && c4 !== -1) buffer += String.fromCharCode(((c3 & 3) << 6) | c4);
  }
  return buffer;
}

function parseSVGPath(d) {
  var vertices = [], inTangents = [], outTangents = [], closed = false;
  var tokens = [];
  var regex = /([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g, match;
  while ((match = regex.exec(d)) !== null) {
    if (match[1]) tokens.push({ type: 'cmd', val: match[1] });
    else tokens.push({ type: 'num', val: parseFloat(match[2]) });
  }
  var px = 0, py = 0, cmd = null, i = 0;
  function nextArgs(count) {
    var res = [];
    for (var k = 0; k < count; k++) {
      if (i < tokens.length && tokens[i].type === 'num') res.push(tokens[i++].val); else break;
    }
    return res.length === count ? res : null;
  }
  while (i < tokens.length) {
    var t = tokens[i];
    if (t.type === 'cmd') { cmd = t.val; i++; }
    else { if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l'; else if (!cmd) { i++; continue; } }
    var isRel = (cmd >= 'a' && cmd <= 'z'), c = cmd.toUpperCase();
    if (c === 'M' || c === 'L') {
      var p = nextArgs(2); if (!p) break;
      var x = p[0], y = p[1]; if (isRel) { x += px; y += py; }
      px = x; py = y; vertices.push([px, py]); inTangents.push([0,0]); outTangents.push([0,0]);
    } else if (c === 'C') {
      var p = nextArgs(6); if (!p) break;
      var x1=p[0],y1=p[1],x2=p[2],y2=p[3],x=p[4],y=p[5];
      if (isRel) { x1+=px;y1+=py;x2+=px;y2+=py;x+=px;y+=py; }
      if (vertices.length > 0) outTangents[vertices.length-1]=[x1-px,y1-py];
      px=x;py=y; vertices.push([px,py]); inTangents.push([x2-px,y2-py]); outTangents.push([0,0]);
    } else if (c === 'V') {
      var p = nextArgs(1); if (!p) break;
      var y = p[0]; if (isRel) y+=py; py=y; vertices.push([px,py]); inTangents.push([0,0]); outTangents.push([0,0]);
    } else if (c === 'H') {
      var p = nextArgs(1); if (!p) break;
      var x = p[0]; if (isRel) x+=px; px=x; vertices.push([px,py]); inTangents.push([0,0]); outTangents.push([0,0]);
    } else if (c === 'Z') { closed = true; }
    else { while (i < tokens.length && tokens[i].type === 'num') i++; }
  }
  return { vertices: vertices, inTangents: inTangents, outTangents: outTangents, closed: closed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-poll shim (app.scheduleTask runs in global scope only)
// ─────────────────────────────────────────────────────────────────────────────
var _fae_ping = null; // set to doPing() once the panel is built
function fae_doPing() {
  if (typeof _fae_ping === 'function') {
    try { _fae_ping(); } catch (e) {}
  }
  // Reschedule — keeps polling every 4 s automatically
  try { app.scheduleTask('fae_doPing()', 4000, false); } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ScriptUI Dialog
// ─────────────────────────────────────────────────────────────────────────────
(function buildUI(thisObj) {

  function createPanel(thisObj) {
    var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", "FAE — Figma ↔ After Effects", undefined, { resizeable: true });
    win.spacing = 4;
    win.margins = 12;
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];

    // ── Status row ──
    var statusGrp = win.add("group");
    statusGrp.orientation = "row";
    statusGrp.alignChildren = ["fill", "center"];
    statusGrp.spacing = 6;

    var statusLabel = statusGrp.add("statictext", undefined, "● Bridge: checking...");
    statusLabel.alignment = ["fill", "center"];
    statusLabel.helpTip = "http://127.0.0.1:7963";

    // ── Options ──
    var optGrp = win.add("group");
    optGrp.orientation = "row";
    optGrp.alignChildren = ["fill", "center"];
    var chkUseActive = optGrp.add("checkbox", undefined, "Use active comp");
    chkUseActive.helpTip = "Put imported layers into the currently open composition instead of creating a new one";

    // ── Buttons ──
    var pullBtn = win.add("button", undefined, "⬇  Pull from Figma");
    pullBtn.helpTip = "Download pending layers from the bridge server and build them in AE";
    pullBtn.enabled = false;

    var pushBtn = win.add("button", undefined, "⬆  Push to Figma");
    pushBtn.helpTip = "Send currently selected AE layers to the Figma plugin via the bridge";

    var clearBtn = win.add("button", undefined, "Clear Bridge Queue");
    clearBtn.helpTip = "Delete any pending data sitting in the bridge server";

    // ── Log ──
    var logLabel = win.add("statictext", undefined, "Log:");
    var logBox = win.add("edittext", undefined, "Ready.", { multiline: true, readonly: true, scrolling: true });
    logBox.preferredSize = [220, 120];

    // ── Footer ──
    var footerGrp = win.add("group");
    footerGrp.orientation = "row";
    footerGrp.alignChildren = ["fill", "center"];
    var footerLabel = footerGrp.add("statictext", undefined, "localhost:7963   ·   FAE v1.0");
    footerLabel.alignment = ["fill", "center"];
    footerLabel.graphics.foregroundColor = footerLabel.graphics.newPen(footerLabel.graphics.PenType.SOLID_COLOR, [0.4, 0.4, 0.4], 1);

    // ── Helpers ──
    var logLines = ["Ready."];
    function log(msg) {
      var time = new Date();
      var ts = time.getHours() + ":" + (time.getMinutes() < 10 ? "0" : "") + time.getMinutes()
             + ":" + (time.getSeconds() < 10 ? "0" : "") + time.getSeconds();
      logLines.push("[" + ts + "] " + msg);
      if (logLines.length > 40) logLines.shift();
      logBox.text = logLines.slice().reverse().join("\n");
    }

    function setStatus(online, pending) {
      if (online) {
        statusLabel.text = (pending ? "● Bridge: DATA PENDING" : "● Bridge: Online");
      } else {
        statusLabel.text = "● Bridge: Offline";
      }
      pullBtn.enabled = (online && pending);
      if (win instanceof Window) win.update();
    }

    // ── Ping ──
    function doPing() {
      var res = bridgePing();
      if (res.ok && res.body) {
        setStatus(true, !!res.body.pending);
        return res.body;
      } else {
        setStatus(false, false);
        return null;
      }
    }
    // Expose to the global auto-poll shim
    _fae_ping = doPing;

    // ── Pull ──
    pullBtn.onClick = function() {
      log("Pulling from bridge...");
      var res = bridgePull();
      if (!res.ok) { log("ERROR: " + (res.error || "pull failed")); return; }
      if (!res.body || res.body.status === "empty") { log("No data pending."); return; }
      var data = res.body;
      log("Building " + data.layers.length + " layer(s)...");
      var result = buildFromData(data, chkUseActive.value);
      if (result.success) {
        log("Done! " + result.layerCount + " layer(s) in '" + result.compName + "'.");
      } else {
        log("ERROR: " + result.error);
      }
      doPing();
    };

    // ── Push ──
    pushBtn.onClick = function() {
      log("Reading AE selection...");
      var sel = readSelection();
      if (!sel.success) { log("ERROR: " + sel.error); return; }
      log("Pushing " + sel.layers.length + " layer(s) to Figma...");
      var res = bridgePushToFigma(sel.layers);
      if (res.ok && res.body && res.body.status === "queued") {
        log("Pushed! Open FAE in Figma to receive.");
      } else {
        log("ERROR: " + (res.error || JSON.stringify(res.body)));
      }
    };

    // ── Clear ──
    clearBtn.onClick = function() {
      var res = bridgeClear();
      log(res.ok ? "Bridge queue cleared." : "ERROR: Could not clear – " + res.error);
      doPing();
    };

    // ── Initial ping + start auto-poll every 4 s ──
    doPing();
    try { app.scheduleTask('fae_doPing()', 4000, false); } catch (e) {}

    if (win instanceof Window) {
      win.center();
      win.show();
    } else {
      win.layout.layout(true);
    }
    return win;
  }

  createPanel(thisObj);

}(this));
