#!/bin/bash
set -euo pipefail

APP_NAME="MemoryLane"
REPO="deusXmachina-dev/memorylane"
INSTALL_DIR="/Applications"

echo "$APP_NAME installer"
echo "===================="
echo ""

# Get latest release tag
echo "Fetching latest release..."
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
  echo "Error: could not determine latest version."
  echo "Check https://github.com/$REPO/releases for available versions."
  exit 1
fi

ZIP_NAME="$APP_NAME-${VERSION#v}-arm64-mac.zip"
ZIP_URL="https://github.com/$REPO/releases/download/$VERSION/$ZIP_NAME"

echo "Latest version: $VERSION"
echo ""

# Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
  echo "Warning: this build is for Apple Silicon (arm64) but you're on $ARCH."
  echo "The app may not work correctly."
  printf "Continue anyway? [y/N] "
  read -r REPLY
  if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
    exit 1
  fi
fi

# Download
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading $ZIP_NAME..."
HTTP_CODE=$(curl -fSL -w "%{http_code}" -o "$TMPDIR/$APP_NAME.zip" "$ZIP_URL" 2>/dev/null) || true

if [ ! -f "$TMPDIR/$APP_NAME.zip" ] || [ "$HTTP_CODE" = "404" ]; then
  echo "Error: download failed (HTTP $HTTP_CODE)."
  echo "URL: $ZIP_URL"
  echo "Check https://github.com/$REPO/releases for available downloads."
  exit 1
fi

# Remove existing installation
if [ -d "$INSTALL_DIR/$APP_NAME.app" ]; then
  echo "Removing existing $APP_NAME.app..."
  rm -rf "$INSTALL_DIR/$APP_NAME.app"
fi

# Unzip to /Applications (ditto preserves code signatures)
echo "Installing to $INSTALL_DIR..."
ditto -xk "$TMPDIR/$APP_NAME.zip" "$INSTALL_DIR"

# Remove quarantine flag if present (safety net)
xattr -cr "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

echo ""
echo "$APP_NAME $VERSION installed successfully!"
echo ""
echo "To launch:"
echo "  open -a $APP_NAME"
echo ""
echo "On first launch, macOS will ask you to grant:"
echo "  - Screen Recording permission"
echo "  - Accessibility permission"
echo ""
echo "You'll also need an OpenRouter API key (https://openrouter.ai)."
