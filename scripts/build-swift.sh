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

echo "Swift OCR binary built successfully"
