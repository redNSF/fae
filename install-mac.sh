#!/bin/bash

# FAE — Installation Script for macOS

echo "Installing FAE After Effects Panel..."

# 1. Create extension directory
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions/fae

# 2. Copy panel files
cp -R ae-panel/ ~/Library/Application\ Support/Adobe/CEP/extensions/fae/

# 3. Enable PlayerDebugMode for unsigned extensions
defaults write com.adobe.CSXS.9 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

# 4. Install Bridge Server dependencies
echo "Installing Bridge Server dependencies..."
cd bridge-server && npm install

echo "Done!"
echo "Next steps:"
echo "1. Start bridge server: cd bridge-server && npm start"
echo "2. Open Figma and load figma-plugin/manifest.json"
echo "3. Open After Effects and look for Window -> Extensions -> FAE"
