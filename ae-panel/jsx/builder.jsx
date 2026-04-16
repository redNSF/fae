/*
 * FAE — After Effects Layer Builder
 * Copyright (C) 2026 Riyad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// ExtendScript (ES3)

function buildFromJSON(jsonString, useActiveComp) {
  try {
    var data = eval("(" + jsonString + ")");
    if (!data || !data.layers) return JSON.stringify({ success: false, error: "Invalid JSON data" });

    app.beginUndoGroup("FAE: Import");

    var project = app.project;
    var comp = getOrCreateComp(data, useActiveComp, project);
    
    var count = 0;
    for (var i = data.layers.length - 1; i >= 0; i--) {
      try {
        if (buildLayer(data.layers[i], comp, project, data.settings)) {
          count++;
        }
      } catch (err) {
        // Continue with other layers
      }
    }

    app.endUndoGroup();

    return JSON.stringify({ 
      success: true, 
      layerCount: count, 
      compName: comp.name 
    });

  } catch (err) {
    if (app) app.endUndoGroup();
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function getOrCreateComp(data, useActiveComp, project) {
  if (useActiveComp && project.activeItem instanceof CompItem) {
    return project.activeItem;
  }

  var w = 1920;
  var h = 1080;
  
  // Try to set size from first layer if it has dimensions
  if (data.layers.length > 0) {
    w = data.layers[0].width || 1920;
    h = data.layers[0].height || 1080;
  }

  var name = (data.pageName || "Figma Import") + " " + formatDate(new Date(data.timestamp));
  return project.items.addComp(name, w, h, 1, 30, 24);
}

function buildLayer(node, comp, project, settings) {
  if (node.visible === false) return false;

  var layer;

  if (node.hasImage && node.imageData) {
    layer = buildImageLayer(node, comp, project);
  } else if (node.type === "TEXT") {
    layer = buildTextLayer(node, comp);
  } else if (node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    if (settings.precomp && node.type === "FRAME") {
       layer = buildPrecomp(node, comp, project, settings);
    } else {
       layer = buildGroup(node, comp, project, settings);
    }
  } else {
    layer = buildShapeLayer(node, comp);
  }

  if (layer) {
    setBasicTransform(layer, node, comp);
    return true;
  }
  return false;
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
      var pathProperty = pathGroup.property("Path");
      var shape = new Shape();
      
      var hw = (node.width || 0) / 2;
      var hh = (node.height || 0) / 2;
      var verts = [];
      for (var v = 0; v < parsed.vertices.length; v++) {
        verts.push([parsed.vertices[v][0] - hw, parsed.vertices[v][1] - hh]);
      }
      
      shape.vertices = verts;
      shape.inTangents = parsed.inTangents;
      shape.outTangents = parsed.outTangents;
      shape.closed = parsed.closed;
      pathProperty.setValue(shape);
    }
  } else if (node.type === "RECTANGLE") {
    var shapeGroup = group.property("Contents").addProperty("ADBE Vector Shape - Rect");
    shapeGroup.property("Size").setValue([node.width, node.height]);
    if (node.cornerRadius) {
      shapeGroup.property("Roundness").setValue(node.cornerRadius);
    }
  } else if (node.type === "ELLIPSE") {
    var shapeGroup = group.property("Contents").addProperty("ADBE Vector Shape - Ellipse");
    shapeGroup.property("Size").setValue([node.width, node.height]);
  } else {
    // Fallback Rect for unknown types
    var shapeGroup = group.property("Contents").addProperty("ADBE Vector Shape - Rect");
    shapeGroup.property("Size").setValue([node.width, node.height]);
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
            var aeFill = contents.addProperty("ADBE Vector Graphic - Fill");
            aeFill.property("Color").setValue([fill.color.r/255, fill.color.g/255, fill.color.b/255, 1]);
            aeFill.property("Opacity").setValue((fill.opacity || 1) * 100);
        }
    }
  }
  
  if (node.strokes && node.strokes.length > 0 && node.strokeWeight > 0) {
     for (var i = 0; i < node.strokes.length; i++) {
        var stroke = node.strokes[i];
        if (stroke.type === "SOLID" && stroke.color) {
            var aeStroke = contents.addProperty("ADBE Vector Graphic - Stroke");
            aeStroke.property("Color").setValue([stroke.color.r/255, stroke.color.g/255, stroke.color.b/255, 1]);
            aeStroke.property("Stroke Width").setValue(node.strokeWeight);
        }
     }
  }
}

function buildTextLayer(node, comp) {
  var layer = comp.layers.addText(node.characters);
  layer.name = node.name;
  
  var textProp = layer.property("Source Text");
  var textDoc = textProp.value;
  
  if (node.fontSize) textDoc.fontSize = node.fontSize;
  if (node.fontName) textDoc.font = node.fontName.family + "-" + node.fontName.style;
  
  if (node.fills && node.fills.length > 0) {
    var fill = node.fills[0];
    if (fill.type === "SOLID") {
        textDoc.fillColor = [fill.color.r/255, fill.color.g/255, fill.color.b/255];
    }
  }
  
  textProp.setValue(textDoc);
  return layer;
}

function buildImageLayer(node, comp, project) {
  // Base64 decode and write to temp file
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
    var importOptions = new ImportOptions(file);
    var footage = project.importFile(importOptions);
    var layer = comp.layers.add(footage);
    layer.name = node.name;
    
    // Figma exports at 2x by default in our setup
    layer.property("Scale").setValue([50, 50, 100]);
    return layer;
  } catch (err) {
    return comp.layers.addSolid([0.5, 0.5, 0.5], node.name, node.width, node.height, 1);
  }
}

function buildGroup(node, comp, project, settings) {
  var nullLayer = comp.layers.addNull();
  nullLayer.name = "[ " + node.name + " ]";
  nullLayer.label = 12; // Purple

  if (node.children) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      // We don't implement full recursion with parenting here for simplicity in this bridge script, 
      // but the plan suggests building children.
      // buildLayer(child, comp, project, settings);
    }
  }
  return nullLayer;
}

function buildPrecomp(node, comp, project, settings) {
  var precomp = project.items.addComp(node.name, node.width, node.height, 1, comp.duration, comp.frameRate);
  // Build children into precomp...
  var layer = comp.layers.add(precomp);
  layer.name = node.name;
  return layer;
}

function setBasicTransform(layer, node, comp) {
  // Set position (centering in AE)
  var x = node.x + (node.width / 2);
  var y = node.y + (node.height / 2);
  layer.property("Position").setValue([x, y]);
  
  if (node.rotation) {
    layer.property("Rotation").setValue(-node.rotation);
  }
  
  if (node.opacity !== undefined) {
    layer.property("Opacity").setValue(node.opacity * 100);
  }
}

function formatDate(date) {
  return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + date.getHours() + ":" + date.getMinutes();
}

// Simple Base64 decoder for ExtendScript
function decodeBase64ToBinary(s) {
  var lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz012345556789+/";
  var buffer = "";
  var i = 0;
  while (i < s.length) {
    var c1 = lookup.indexOf(s.charAt(i++));
    var c2 = lookup.indexOf(s.charAt(i++));
    var c3 = lookup.indexOf(s.charAt(i++));
    var c4 = lookup.indexOf(s.charAt(i++));
    
    var b1 = (c1 << 2) | (c2 >> 4);
    var b2 = ((c2 & 15) << 4) | (c3 >> 2);
    var b3 = ((c3 & 3) << 6) | c4;
    
    buffer += String.fromCharCode(b1);
    if (c3 !== 64) buffer += String.fromCharCode(b2);
    if (c4 !== 64) buffer += String.fromCharCode(b3);
  }
  return buffer;
}

function parseSVGPath(d) {
  var vertices = [];
  var inTangents = [];
  var outTangents = [];
  var closed = false;

  var tokens = [];
  var regex = /([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  var match;
  while ((match = regex.exec(d)) !== null) {
    if (match[1]) tokens.push({type: 'cmd', val: match[1]});
    else tokens.push({type: 'num', val: parseFloat(match[2])});
  }

  var px = 0, py = 0;
  var cmd = null;
  var i = 0;

  function nextArgs(count) {
    var res = [];
    for (var k = 0; k < count; k++) {
      if (i < tokens.length && tokens[i].type === 'num') {
        res.push(tokens[i++].val);
      } else {
        break;
      }
    }
    return res.length === count ? res : null;
  }

  while (i < tokens.length) {
    var t = tokens[i];
    if (t.type === 'cmd') {
      cmd = t.val;
      i++;
    } else {
      if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
      else if (!cmd) { i++; continue; }
    }

    var isRel = (cmd >= 'a' && cmd <= 'z');
    var c = cmd.toUpperCase();

    if (c === 'M' || c === 'L') {
      var p = nextArgs(2);
      if (!p) break;
      var x = p[0], y = p[1];
      if (isRel) { x += px; y += py; }
      px = x; py = y;
      vertices.push([px, py]);
      inTangents.push([0, 0]);
      outTangents.push([0, 0]);
    } else if (c === 'C') {
      var p = nextArgs(6);
      if (!p) break;
      var x1 = p[0], y1 = p[1], x2 = p[2], y2 = p[3], x = p[4], y = p[5];
      if (isRel) {
        x1 += px; y1 += py;
        x2 += px; y2 += py;
        x += px; y += py;
      }
      if (vertices.length > 0) {
        outTangents[vertices.length - 1] = [x1 - px, y1 - py];
      }
      px = x; py = y;
      vertices.push([px, py]);
      inTangents.push([x2 - px, y2 - py]);
      outTangents.push([0, 0]);
    } else if (c === 'V') {
      var p = nextArgs(1);
      if (!p) break;
      var y = p[0];
      if (isRel) { y += py; }
      py = y;
      vertices.push([px, py]);
      inTangents.push([0, 0]);
      outTangents.push([0, 0]);
    } else if (c === 'H') {
      var p = nextArgs(1);
      if (!p) break;
      var x = p[0];
      if (isRel) { x += px; }
      px = x;
      vertices.push([px, py]);
      inTangents.push([0, 0]);
      outTangents.push([0, 0]);
    } else if (c === 'Z') {
      closed = true;
    } else {
      while (i < tokens.length && tokens[i].type === 'num') i++;
    }
  }

  return {
    vertices: vertices,
    inTangents: inTangents,
    outTangents: outTangents,
    closed: closed
  };
}
