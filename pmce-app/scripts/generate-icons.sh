#!/usr/bin/env bash
#
# Generates all application icon assets from a single source image.
#
# Source:  pmca-gui/public/icons/pmce-icon.png  (square, high-res, transparent)
#          Optionally flattened onto a solid background via ICON_BG (see below).
# Outputs:
#   public/icons/*                 web / PWA / favicon assets referenced by index.html
#   public/favicon.ico             root favicon referenced by index.html
#   src-electron/icons/icon.icns   macOS packaged app icon
#   src-electron/icons/icon.ico    Windows packaged app icon
#   src-electron/icons/icon.png    Linux packaged app icon (512x512)
#   build/icon.png                 electron-builder resource icon (512x512)
#
# Requires macOS tools: sips, iconutil. Uses ImageMagick `magick`/`convert`
# for .ico generation when available, otherwise falls back to a PNG-based .ico.
#
# Environment variables:
#   ICON_BG   Background color to flatten the (transparent) source onto.
#             Defaults to "none" (keep transparency). Set to "black" (or any
#             ImageMagick/sips color) to fill the transparent background.
#             Example:  ICON_BG=black bash scripts/generate-icons.sh

set -euo pipefail

GUI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIG_SRC="$GUI_DIR/public/icons/pmce-icon.png"
ICON_BG="${ICON_BG:-none}"

if [[ ! -f "$ORIG_SRC" ]]; then
  echo "ERROR: source icon not found at $ORIG_SRC" >&2
  exit 1
fi

PUB_ICONS="$GUI_DIR/public/icons"
ELECTRON_ICONS="$GUI_DIR/src-electron/icons"
BUILD_DIR="$GUI_DIR/build"

mkdir -p "$PUB_ICONS" "$ELECTRON_ICONS" "$BUILD_DIR"

# Resolve the working source. When a background color is requested, flatten the
# transparent source onto that color so every generated asset shares it.
SRC="$ORIG_SRC"
if [[ "$ICON_BG" != "none" ]]; then
  FLAT_DIR="$(mktemp -d)"
  SRC="$FLAT_DIR/source-flattened.png"
  echo "==> Flattening source onto background color: $ICON_BG"
  if command -v magick >/dev/null 2>&1; then
    magick "$ORIG_SRC" -background "$ICON_BG" -alpha remove -alpha off "$SRC"
  elif command -v convert >/dev/null 2>&1; then
    convert "$ORIG_SRC" -background "$ICON_BG" -alpha remove -alpha off "$SRC"
  else
    # sips fallback: composite over a solid color canvas of matching size.
    W="$(sips -g pixelWidth "$ORIG_SRC" | awk '/pixelWidth/{print $2}')"
    H="$(sips -g pixelHeight "$ORIG_SRC" | awk '/pixelHeight/{print $2}')"
    sips -s format png --padColor "$ICON_BG" -p "$H" "$W" "$ORIG_SRC" --out "$SRC" >/dev/null
  fi
fi

png() {
  # png <size> <output>
  sips -s format png -z "$1" "$1" "$SRC" --out "$2" >/dev/null
}

echo "==> Generating web / PWA icons"
png 512 "$PUB_ICONS/android-chrome-512x512.png"
png 192 "$PUB_ICONS/android-chrome-192x192.png"
png 180 "$PUB_ICONS/apple-touch-icon.png"
png 128 "$PUB_ICONS/icon-128x128.png"
png 96  "$PUB_ICONS/icon-96x96.png"
png 32  "$PUB_ICONS/icon-32x32.png"
png 16  "$PUB_ICONS/icon-16x16.png"
png 32  "$PUB_ICONS/favicon-32x32.png"

echo "==> Generating Electron / builder PNG icons (512x512)"
png 512 "$ELECTRON_ICONS/icon.png"
png 512 "$BUILD_DIR/icon.png"

echo "==> Generating macOS .icns"
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
png 16   "$ICONSET/icon_16x16.png"
png 32   "$ICONSET/icon_16x16@2x.png"
png 32   "$ICONSET/icon_32x32.png"
png 64   "$ICONSET/icon_32x32@2x.png"
png 128  "$ICONSET/icon_128x128.png"
png 256  "$ICONSET/icon_128x128@2x.png"
png 256  "$ICONSET/icon_256x256.png"
png 512  "$ICONSET/icon_256x256@2x.png"
png 512  "$ICONSET/icon_512x512.png"
png 1024 "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ELECTRON_ICONS/icon.icns"

echo "==> Generating Windows .ico and favicon.ico"
if command -v magick >/dev/null 2>&1; then
  magick "$SRC" -define icon:auto-resize=256,128,64,48,32,16 "$ELECTRON_ICONS/icon.ico"
  magick "$SRC" -define icon:auto-resize=64,48,32,16 "$GUI_DIR/public/favicon.ico"
elif command -v convert >/dev/null 2>&1; then
  convert "$SRC" -define icon:auto-resize=256,128,64,48,32,16 "$ELECTRON_ICONS/icon.ico"
  convert "$SRC" -define icon:auto-resize=64,48,32,16 "$GUI_DIR/public/favicon.ico"
else
  echo "    ImageMagick not found — writing PNG-backed .ico fallbacks (single 256px frame)"
  png 256 "$ELECTRON_ICONS/icon.ico"
  png 32  "$GUI_DIR/public/favicon.ico"
fi

echo "==> Done. Generated assets:"
echo "    public/icons/{android-chrome-512x512,android-chrome-192x192,apple-touch-icon,icon-128x128,icon-96x96,icon-32x32,icon-16x16,favicon-32x32}.png"
echo "    public/favicon.ico"
echo "    src-electron/icons/{icon.icns,icon.ico,icon.png}"
echo "    build/icon.png"
