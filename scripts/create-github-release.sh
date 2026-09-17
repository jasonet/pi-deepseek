#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"
ZIP="apps/desktop/release/Taosi-${VERSION}-mac-arm64.zip"

if [ ! -f "$ZIP" ]; then
  echo "Error: Release asset $ZIP not found!" >&2
  exit 1
fi

echo "Creating GitHub release v${VERSION} with ${ZIP}..."
gh release create "v${VERSION}" "$ZIP" \
  -R jasonet/pi-deepseek \
  --title "Taosi ${VERSION}" \
  --notes-file "apps/desktop/release/notes-${VERSION}.md" 2>/dev/null || \
gh release create "v${VERSION}" "$ZIP" \
  -R jasonet/pi-deepseek \
  --title "Taosi ${VERSION}" \
  --generate-notes
