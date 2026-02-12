#!/bin/bash
set -euo pipefail

APP_NAME="MemoryLane"
REPO="deusXmachina-dev/memorylane"
INSTALL_DIR="/Applications"
ZIP_NAME="$APP_NAME-arm64-mac.zip"
ZIP_URL="https://github.com/$REPO/releases/latest/download/$ZIP_NAME"

echo "$APP_NAME installer"
echo "===================="
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
curl -fSL -# -o "$TMPDIR/$APP_NAME.zip" -w "%{http_code}" "$ZIP_URL" > "$TMPDIR/http_code" || true
HTTP_CODE=$(<"$TMPDIR/http_code")

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
echo "$APP_NAME installed successfully!"
echo ""
echo "To launch:"
echo "  open -a $APP_NAME"
echo ""
echo "On first launch, macOS will ask you to grant:"
echo "  - Screen Recording permission"
echo "  - Accessibility permission"
echo ""
echo "You'll also need an OpenRouter API key (https://openrouter.ai)."
