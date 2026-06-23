#!/usr/bin/env bash
# Runs INSIDE electronuserland/builder:wine (amd64) to cross-build the Windows
# and Linux 2.6.4 artifacts. The repo is mounted read-write at /project; we copy
# it into /build (excluding node_modules/.git/release/out) so the host's macOS
# node_modules is never touched, do a clean install, build once, then package
# Linux (node-pty compiles in-container) and Windows (ships the win32-x64
# prebuild; native rebuild disabled since MSVC isn't available under wine).
set -euo pipefail

echo "=== [1/6] toolchain ==="
corepack enable
corepack prepare pnpm@10.25.0 --activate
node --version
pnpm --version

echo "=== [2/6] copy source into /build (protect host node_modules) ==="
mkdir -p /build
# rsync isn't in the image; use a tar pipe. --exclude without a slash matches
# the basename at any depth, so node_modules/.git are dropped everywhere.
tar -cf - \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='./apps/desktop/release' \
  --exclude='./apps/desktop/out' \
  -C /project . | tar -xf - -C /build

cd /build

echo "=== [3/6] pnpm install ==="
pnpm install --frozen-lockfile

cd /build/apps/desktop

echo "=== [4/6] build (deps + stage extensions + electron-vite) ==="
pnpm run build

mkdir -p /project/apps/desktop/release

echo "=== [5/6] package LINUX (AppImage + deb) ==="
pnpm exec electron-builder --linux --publish never
# Copy Linux artifacts back immediately so a later Windows failure can't lose them.
cp -f release/*.AppImage release/*.deb release/latest-linux*.yml \
      /project/apps/desktop/release/ 2>/dev/null || true
echo "Linux artifacts copied back."

echo "=== [5b/6] package WINDOWS (nsis + portable, prebuilt node-pty) ==="
# Best-effort: wine runs win32 helpers (rcedit) that often abort under qemu
# emulation on Apple Silicon. Don't let a Windows failure abort the script.
if pnpm exec electron-builder --win --publish never -c.npmRebuild=false; then
  cp -f release/*.exe release/latest.yml \
        /project/apps/desktop/release/ 2>/dev/null || true
  echo "WINDOWS-OK"
else
  echo "WINDOWS-FAILED (likely wine/qemu emulation limitation on arm64 host)"
fi

echo "=== [6/6] produced ==="
ls -la /project/apps/desktop/release/ | grep -iE 'appimage|\.deb|\.exe|latest' || true
echo "DOCKER-BUILD-DONE"
