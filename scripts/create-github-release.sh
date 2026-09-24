#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"
ZIP="apps/desktop/release/Taosi-${VERSION}-mac-arm64.zip"
FEED="apps/desktop/release/latest-mac.yml"

if [ ! -f "$ZIP" ]; then
  echo "Error: Release asset $ZIP not found!" >&2
  exit 1
fi

# Ensure update feed is generated and verified
echo "Generating and verifying macOS update feed for v${VERSION}..."
PI_APP_RELEASE_VERSION="$VERSION" node scripts/generate-mac-update-feed.mjs
PI_APP_RELEASE_VERSION="$VERSION" node apps/desktop/scripts/assert-mac-update-assets.mjs

ASSETS=()
for f in apps/desktop/release/Taosi-${VERSION}* apps/desktop/release/latest-mac.yml; do
  if [ -f "$f" ]; then
    ASSETS+=("$f")
  fi
done

echo "Creating / updating GitHub release v${VERSION} with ${#ASSETS[@]} assets..."
if gh release view "v${VERSION}" -R jasonet/pi-deepseek >/dev/null 2>&1; then
  echo "Release v${VERSION} exists, uploading assets..."
  gh release upload "v${VERSION}" "${ASSETS[@]}" -R jasonet/pi-deepseek --clobber
else
  NOTES_ARGS=()
  if [ -f "apps/desktop/release/notes-${VERSION}.md" ]; then
    NOTES_ARGS=(--notes-file "apps/desktop/release/notes-${VERSION}.md")
  else
    NOTES_ARGS=(--generate-notes)
  fi

  gh release create "v${VERSION}" "${ASSETS[@]}" \
    -R jasonet/pi-deepseek \
    --title "Taosi ${VERSION}" \
    "${NOTES_ARGS[@]}"
fi
echo "Release v${VERSION} ready with macOS assets."
