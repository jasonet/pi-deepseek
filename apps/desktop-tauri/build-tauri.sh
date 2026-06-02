#!/bin/bash
# Build script for Pi-Deepseek Tauri 2
# Usage:
#   ./build-tauri.sh              # Build "without-pi" variant
#   ./build-tauri.sh with-pi      # Build "with-pi" variant

set -e
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/src-tauri"

VARIANT="${1:-without-pi}"

echo "========================================"
echo "Pi-Deepseek Tauri 2 Build"
echo "Variant: $VARIANT"
echo "========================================"

# Build Rust backend
if [ "$VARIANT" = "with-pi" ]; then
    echo ""
    echo "--- Building with-pi variant (bundles pi CLI) ---"
    cargo build --release --features with-pi
    SUFFIX="-with-pi"
else
    echo ""
    echo "--- Building without-pi variant (requires separate pi install) ---"
    cargo build --release --features without-pi
    SUFFIX="-without-pi"
fi

# Copy binary
mkdir -p ../release
cp "target/release/pi-deepseek" "../release/pi-deepseek${SUFFIX}" 2>/dev/null || true

echo ""
echo "========================================"
echo "Build complete!"
echo "Binary: release/pi-deepseek${SUFFIX}"
echo ""
echo "To bundle with Tauri (requires web frontend):"
echo "  cargo tauri build --features $VARIANT"
echo "========================================"
