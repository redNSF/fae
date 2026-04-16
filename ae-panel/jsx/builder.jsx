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
    if (node.type === "COMPONENT" || (settings.precomp && node.type === "FRAME")) {
       layer = buildPrecomp(node, comp, project, settings);
    } else if (node.type === "INSTANCE") {
       if (node.mainComponentId) {
          var existingComp = findPrecompByComponentId(project, node.mainComponentId);
          if (existingComp) {
             layer = comp.layers.add(existingComp);
             layer.name = node.name;
          } else {
             layer = buildGroup(node, comp, project, settings);
          }
       } else {
          layer = buildGroup(node, comp, project, settings);
       }
    } else {
       layer = buildGroup(node, comp, project, settings);
    }
  } else {
    layer = buildShapeLayer(node, comp);
  }

  if (layer) {
    setBasicTransform(layer, node, comp);
    if (node.effects && node.effects.length > 0) {
      applyEffects(layer, node.effects);
    }
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
          if (effect.color.a !== undefined) {
            ds.property("Opacity").setValue(effect.color.a * 255); 
          }
        }
        if (effect.offset) {
          var y = effect.offset.y;
          var x = effect.offset.x;
          var angle = Math.atan2(y, x) * 180 / Math.PI;
          ds.property("Direction").setValue(angle);
          ds.property("Distance").setValue(Math.sqrt(x*x + y*y));
        }
        if (effect.radius !== undefined) {
          ds.property("Softness").setValue(effect.radius);
        }
      }
    } else if (effect.type === "LAYER_BLUR") {
      var blur = fxProp.addProperty("ADBE Gaussian Blur 2");
      if (blur && effect.radius !== undefined) {
        blur.property("Blurriness").setValue(effect.radius);
      }
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
      
      for (var i = 1; i < node.styledSegments.length; i++) {
        var seg = node.styledSegments[i];
        var animator = layer.property("Text").property("Animators").addProperty("ADBE Text Animator");
        var selector = animator.property("Selectors").addProperty("ADBE Text Selector");
        selector.property("Units").setValue(2); // 2 = Index
        selector.property("Start").setValue(seg.start);
        selector.property("End").setValue(seg.end);
        
        if (seg.color && (!baseSeg.color || seg.color.r !== baseSeg.color.r || seg.color.g !== baseSeg.color.g || seg.color.b !== baseSeg.color.b)) {
           var fillProp = animator.property("Properties").addProperty("ADBE Text Fill Color");
           fillProp.setValue([seg.color.r/255, seg.color.g/255, seg.color.b/255]);
        }
      }
    }
  } else {
    if (node.fontSize) textDoc.fontSize = node.fontSize;
    if (node.fontName) textDoc.font = node.fontName.family + "-" + node.fontName.style;
    if (node.fills && node.fills.length > 0) {
      var fill = node.fills[0];
      if (fill.type === "SOLID") {
          textDoc.fillColor = [fill.color.r/255, fill.color.g/255, fill.color.b/255];
      }
    }
    textProp.setValue(textDoc);
  }
  
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

  var childLayers = [];

  if (node.children) {
    for (var i = node.children.length - 1; i >= 0; i--) {
      var child = node.children[i];
      var countBefore = comp.numLayers;
      buildLayer(child, comp, project, settings);
      var countAfter = comp.numLayers;
      
      if (countAfter > countBefore) {
        for (var idx = 1; idx <= countAfter - countBefore; idx++) {
          childLayers.push(comp.layer(idx));
        }
      }
    }
  }

  if (node.clipsContent === true && childLayers.length > 0) {
    var matte = comp.layers.addSolid([1, 1, 1], node.name + " Matte", Math.max(1, node.width || 100), Math.max(1, node.height || 100), 1);
    var px = (node.x !== undefined ? node.x : 0) + (node.width || 100) / 2;
    var py = (node.y !== undefined ? node.y : 0) + (node.height || 100) / 2;
    matte.property("Position").setValue([px, py]);
    matte.enabled = false;
    
    // Apply track matte to bottom-most child exclusively if older AE, or all mapped children natively in 23.0+
    for (var k = 0; k < childLayers.length; k++) {
      var targetLayer = childLayers[k];
      if (typeof targetLayer.setTrackMatte !== "undefined") {
        targetLayer.setTrackMatte(matte, TrackMatteType.ALPHA);
      } else if (k === childLayers.length - 1) { 
        matte.moveBefore(targetLayer);
        targetLayer.trackMatteType = TrackMatteType.ALPHA;
        break;
      }
    }
  }

  return nullLayer;
}

function buildPrecomp(node, comp, project, settings) {
  var precomp = project.items.addComp(node.name, node.width || 100, node.height || 100, 1, comp.duration || 10, comp.frameRate || 30);
  
  // Save ID for reinstancing
  precomp.comment = (node.type === "COMPONENT") ? node.id : node.mainComponentId;

  if (node.children) {
    for (var i = node.children.length - 1; i >= 0; i--) {
      var child = node.children[i];
      buildLayer(child, precomp, project, settings);
    }
  }

  var layer = comp.layers.add(precomp);
  layer.name = node.name;
  return layer;
}

function findPrecompByComponentId(project, id) {
  for (var i = 1; i <= project.numItems; i++) {
    var item = project.item(i);
    if (item instanceof CompItem && item.comment === id) {
      return item;
    }
  }
  return null;
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

function extractShapeData(propGroup, outFills, outStrokes, outPaths) {
  for (var i = 1; i <= propGroup.numProperties; i++) {
    var prop = propGroup.property(i);
    if (!prop) continue;
    
    if (prop.matchName === "ADBE Vector Graphic - Fill" && prop.enabled) {
      var col = prop.property("Color").value;
      var op = prop.property("Opacity").value / 100;
      outFills.push({ r: col[0], g: col[1], b: col[2], a: op });
    } else if (prop.matchName === "ADBE Vector Graphic - Stroke" && prop.enabled) {
      var col = prop.property("Color").value;
      var op = prop.property("Opacity").value / 100;
      var sw = prop.property("Stroke Width").value;
      outStrokes.push({ r: col[0], g: col[1], b: col[2], a: op, weight: sw });
    } else if (prop.matchName === "ADBE Vector Shape - Group") {
      try {
        var pathObj = prop.property("Path").value;
        outPaths.push({
          vertices: pathObj.vertices,
          inTangents: pathObj.inTangents,
          outTangents: pathObj.outTangents,
          closed: pathObj.closed
        });
      } catch(e) {}
    } else if (prop.propertyType === PropertyType.PROPERTY_GROUP || prop.propertyType === PropertyType.INDEXED_GROUP) {
      extractShapeData(prop, outFills, outStrokes, outPaths);
    }
  }
}

function readSelection() {
  try {
    if (!app.project.activeItem || !(app.project.activeItem instanceof CompItem)) {
      return JSON.stringify({ success: false, error: "No active comp selected." });
    }
    
    var comp = app.project.activeItem;
    var selected = comp.selectedLayers;
    if (selected.length === 0) {
      return JSON.stringify({ success: false, error: "No layers selected." });
    }
    
    var layersData = [];
    
    for (var i = 0; i < selected.length; i++) {
      var layer = selected[i];
      var data = {
        name: layer.name,
        type: "UNKNOWN",
        x: layer.property("Transform").property("Position").value[0],
        y: layer.property("Transform").property("Position").value[1],
        rotation: layer.property("Transform").property("Rotation").value,
        opacity: layer.property("Transform").property("Opacity").value / 100,
        scaleX: layer.property("Transform").property("Scale").value[0] / 100,
        scaleY: layer.property("Transform").property("Scale").value[1] / 100,
        visible: layer.enabled
      };
      
      var ap = layer.property("Transform").property("Anchor Point").value;
      data.anchorX = ap[0];
      data.anchorY = ap[1];
      
      if (layer instanceof ShapeLayer) {
        data.type = "SHAPE";
        var outFills = [];
        var outStrokes = [];
        var outPaths = [];
        extractShapeData(layer.property("Contents"), outFills, outStrokes, outPaths);
        data.fills = outFills;
        data.strokes = outStrokes;
        data.paths = outPaths;
        
        if (typeof layer.sourceRectAtTime === 'function') {
          var rect = layer.sourceRectAtTime(comp.time, false);
          data.width = rect.width;
          data.height = rect.height;
          data.rectLeft = rect.left;
          data.rectTop = rect.top;
        }
      } else if (layer instanceof TextLayer) {
        data.type = "TEXT";
        var textDoc = layer.property("Source Text").value;
        data.characters = textDoc.text;
        data.fontSize = textDoc.fontSize;
        data.fontName = textDoc.font;
        if (textDoc.fillColor) {
           data.fillColor = {
              r: textDoc.fillColor[0],
              g: textDoc.fillColor[1],
              b: textDoc.fillColor[2]
           };
        }
        if (typeof layer.sourceRectAtTime === 'function') {
          var rect = layer.sourceRectAtTime(comp.time, false);
          data.width = rect.width;
          data.height = rect.height;
          data.rectLeft = rect.left;
          data.rectTop = rect.top;
        }
      } else if (layer instanceof AVLayer) {
        data.type = (layer.source instanceof CompItem) ? "PRECOMP" : "AVLAYER";
        data.width = layer.width;
        data.height = layer.height;
      }
      
      layersData.push(data);
    }
    
    return JSON.stringify({ success: true, layers: layersData });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.toString() });
  }
}
