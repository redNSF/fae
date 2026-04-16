/*
 * FAE Plugin — code.js (sandboxed)
 * Copyright (C) 2026 Riyad Shuvro
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// Handles layer serialization and communication with ui.html

figma.showUI(__html__, { width: 280, height: 420 });

// Listen for messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'push-selection') {
    await handlePushSelection(msg.settings);
  } else if (msg.type === 'pull-ae-data') {
    await reconstructAENodes(msg.payload);
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};

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

  // Serialize effects
  if (node.effects && node.effects !== figma.mixed) {
    data.effects = node.effects.map(function(effect) {
      var eff = {
        type: effect.type,
        visible: effect.visible,
        radius: effect.radius
      };
      if (effect.color) {
        eff.color = {
          r: effect.color.r,
          g: effect.color.g,
          b: effect.color.b,
          a: effect.color.a
        };
      }
      if (effect.offset) {
        eff.offset = { x: effect.offset.x, y: effect.offset.y };
      }
      if (effect.spread !== undefined) {
        eff.spread = effect.spread;
      }
      return eff;
    });
  }

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

  // Vector paths
  if (node.vectorPaths) {
    data.vectorPaths = node.vectorPaths.map(function(path) {
      return {
        windingRule: path.windingRule,
        data: path.data
      };
    });
  }

  // Text-specific properties
  if (node.type === 'TEXT') {
    data.characters = node.characters;
    data.textAlignHorizontal = node.textAlignHorizontal;
    data.textAlignVertical = node.textAlignVertical;

    if (typeof node.getStyledTextSegments === 'function') {
      var segments = node.getStyledTextSegments([
        'fontName', 'fontSize', 'fills', 'textDecoration',
        'textCase', 'letterSpacing', 'lineHeight', 'fontWeight'
      ]);
      data.styledSegments = segments.map(function(seg) {
        var s = {
          characters: seg.characters,
          start: seg.start,
          end: seg.end,
          fontSize: seg.fontSize,
          textDecoration: seg.textDecoration,
          textCase: seg.textCase,
          fontWeight: seg.fontWeight
        };
        if (seg.fontName) {
          s.fontName = {
            family: seg.fontName.family,
            style: seg.fontName.style
          };
        }
        if (seg.fills && seg.fills.length > 0) {
          var fill = seg.fills[0];
          if (fill.type === 'SOLID' && fill.color) {
            s.color = {
              r: Math.round(fill.color.r * 255),
              g: Math.round(fill.color.g * 255),
              b: Math.round(fill.color.b * 255)
            };
          }
        }
        if (seg.letterSpacing) s.letterSpacing = seg.letterSpacing;
        if (seg.lineHeight) s.lineHeight = seg.lineHeight;
        return s;
      });
    } else {
      data.fontSize = node.fontSize;
      if (node.fontName && node.fontName !== figma.mixed) {
        data.fontName = {
          family: node.fontName.family,
          style: node.fontName.style
        };
      }
      if (node.letterSpacing && node.letterSpacing !== figma.mixed) {
        data.letterSpacing = node.letterSpacing;
      }
      if (node.lineHeight && node.lineHeight !== figma.mixed) {
        data.lineHeight = node.lineHeight;
      }
      data.textDecoration = node.textDecoration;
      data.textCase = node.textCase;
    }
  }

  // Component tracking
  if (node.type === 'COMPONENT') {
    data.isMainComponent = true;
  } else if (node.type === 'INSTANCE') {
    if (node.mainComponent) {
      data.mainComponentId = node.mainComponent.id;
    }
    data.componentProperties = node.componentProperties;
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

async function reconstructAENodes(payload) {
  if (!payload || !payload.layers) return;
  
  var newNodes = [];
  var layers = payload.layers;
  
  // Font loading is strictly required by Figma API before instantiating text
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  } catch(e) {}

  // Parse in reverse to maintain accurate AE z-index mapping (AE index 0 = top)
  for (var i = layers.length - 1; i >= 0; i--) {
    var l = layers[i];
    var node;
    
    if (l.type === "SHAPE" || l.type === "AVLAYER" || l.type === "PRECOMP" || l.type === "UNKNOWN") {
       node = figma.createRectangle();
       var w = l.width || 100;
       var h = l.height || 100;
       node.resize(Math.max(1, w * Math.abs(l.scaleX || 1)), Math.max(1, h * Math.abs(l.scaleY || 1)));
       
       if (l.type === "SHAPE" && l.fills && l.fills.length > 0) {
          var fills = [];
          for (var f=0; f<l.fills.length; f++) {
             var fill = l.fills[f];
             fills.push({ type: 'SOLID', color: {r: fill.r, g: fill.g, b: fill.b}, opacity: fill.a !== undefined ? fill.a : 1 });
          }
          node.fills = fills;
       }
       if (l.type === "SHAPE" && l.strokes && l.strokes.length > 0) {
          var strokes = [];
          var sw = l.strokes[0].weight || 1;
          for (var s=0; s<l.strokes.length; s++) {
             var str = l.strokes[s];
             strokes.push({ type: 'SOLID', color: {r: str.r, g: str.g, b: str.b}, opacity: str.a !== undefined ? str.a : 1 });
          }
          node.strokes = strokes;
          node.strokeWeight = sw;
       }
    } else if (l.type === "TEXT") {
       node = figma.createText();
       try {
           node.fontName = { family: "Inter", style: "Regular" };
       } catch(e) {}
       node.characters = l.characters || "Text";
       node.fontSize = (l.fontSize || 12) * Math.abs(l.scaleX || 1);
       if (l.fillColor) {
           node.fills = [{ type: 'SOLID', color: {r: l.fillColor.r, g: l.fillColor.g, b: l.fillColor.b} }];
       }
    }
    
    if (node) {
       node.name = l.name || "AE Layer";
       
       var ax = (l.anchorX || 0) * Math.abs(l.scaleX || 1);
       var ay = (l.anchorY || 0) * Math.abs(l.scaleY || 1);
       
       node.x = l.x - ax;
       node.y = l.y - ay;
       
       node.rotation = -(l.rotation || 0);
       node.opacity = typeof l.opacity === 'number' ? l.opacity : 1;
       node.visible = l.visible !== false;
       
       figma.currentPage.appendChild(node);
       newNodes.push(node);
    }
  }
  
  if (newNodes.length > 0) {
    figma.currentPage.selection = newNodes;
    figma.viewport.scrollAndZoomIntoView(newNodes);
    figma.notify('Imported ' + newNodes.length + ' layer(s) from After Effects');
  }
}

