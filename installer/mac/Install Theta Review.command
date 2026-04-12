#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Workflow Integration Plugins/Theta Review"

echo "================================================"
echo "  Theta Review Plugin Installer"
echo "================================================"
echo ""

# Check if Resolve plugins dir exists (Resolve has been installed)
PLUGINS_ROOT="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Workflow Integration Plugins"
if [ ! -d "$PLUGINS_ROOT" ]; then
    mkdir -p "$PLUGINS_ROOT"
fi

# Remove previous install if present
if [ -d "$DEST" ]; then
    echo "Removing previous install..."
    rm -rf "$DEST"
fi

echo "Installing plugin..."
mkdir -p "$DEST"
cp -r "$SCRIPT_DIR/plugin/"* "$DEST/"

echo ""
echo "✓ Installed to:"
echo "  $DEST"
echo ""
echo "Restart DaVinci Resolve to load the plugin."
echo "(Workspace → Workflow Integrations → Theta Review)"
echo ""
read -p "Press Enter to close..."
