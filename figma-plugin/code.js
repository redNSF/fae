/*
 * FAE Plugin — code.js (sandboxed)
 * Copyright (C) 2026 Riyad
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
    data.fontSize = node.fontSize;
    if (node.fontName && node.fontName !== figma.mixed) {
      data.fontName = {
        family: node.fontName.family,
        style: node.fontName.style
      };
    }
    data.textAlignHorizontal = node.textAlignHorizontal;
    data.textAlignVertical = node.textAlignVertical;
    if (node.letterSpacing && node.letterSpacing !== figma.mixed) {
      data.letterSpacing = node.letterSpacing;
    }
    if (node.lineHeight && node.lineHeight !== figma.mixed) {
      data.lineHeight = node.lineHeight;
    }
    data.textDecoration = node.textDecoration;
    data.textCase = node.textCase;
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
