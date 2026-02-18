#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$ROOT_DIR/build/swift"

mkdir -p "$OUT_DIR"

echo "Compiling ocr.swift → build/swift/ocr"
swiftc -O \
  -target arm64-apple-macos13.0 \
  "$ROOT_DIR/src/main/processor/swift/ocr.swift" \
  -o "$OUT_DIR/ocr"

echo "Compiling app-watcher.swift → build/swift/app-watcher"
swiftc -O \
  -target arm64-apple-macos13.0 \
  "$ROOT_DIR/src/main/recorder/swift/app-watcher.swift" \
  -o "$OUT_DIR/app-watcher"

echo "Compiling screen-recorder.swift → build/swift/screen-recorder"
swiftc -O \
  -target arm64-apple-macos13.0 \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework CoreMedia \
  -framework VideoToolbox \
  "$ROOT_DIR/src/main/recorder/swift/screen-recorder.swift" \
  -o "$OUT_DIR/screen-recorder"

echo "Swift binaries built successfully"
