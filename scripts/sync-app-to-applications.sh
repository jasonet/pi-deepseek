#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SRC="$ROOT_DIR/apps/desktop/release/mac-arm64/Taosi.app"
APP_DEST="/Applications/Taosi.app"

if [ ! -d "$APP_SRC" ]; then
  # Fallback to versioned folder if present
  LATEST_VER=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("package.json")).version)')
  APP_SRC="$ROOT_DIR/apps/desktop/release-${LATEST_VER}/mac-arm64/Taosi.app"
fi

if [ ! -d "$APP_SRC" ]; then
  echo "Error: Taosi.app not found in release directories. Please package first." >&2
  exit 1
fi

echo "Syncing latest Taosi.app to /Applications..."
echo "Source: $APP_SRC"
echo "Destination: $APP_DEST"

rm -rf "$APP_DEST"
cp -R "$APP_SRC" "$APP_DEST"

echo "Sync completed successfully. Installed version:"
defaults read "$APP_DEST/Contents/Info.plist" CFBundleShortVersionString
