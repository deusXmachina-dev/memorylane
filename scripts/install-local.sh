#!/bin/bash
set -euo pipefail

APP_NAME="MemoryLane"
INSTALL_DIR="/Applications"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"

VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
ZIP_NAME="$APP_NAME-arm64-mac.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

echo "$APP_NAME local installer"
echo "=========================="
echo ""
echo "Version: $VERSION"
echo "Source:  $ZIP_PATH"
echo ""

if [ ! -f "$ZIP_PATH" ]; then
  echo "Error: $ZIP_NAME not found in dist/."
  echo "Run 'npm run make:mac' first to build the zip."
  exit 1
fi

# Remove existing installation
if [ -d "$INSTALL_DIR/$APP_NAME.app" ]; then
  echo "Removing existing $APP_NAME.app..."
  rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

# Unzip to /Applications (ditto preserves code signatures)
echo "Installing to $INSTALL_DIR..."
ditto -xk "$ZIP_PATH" "$INSTALL_DIR"

# Remove quarantine flag
xattr -cr "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

echo ""
echo "$APP_NAME $VERSION installed successfully!"
echo ""
echo "To launch:"
echo "  open -a $APP_NAME"
