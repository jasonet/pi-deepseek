# Desktop App

Codex-style Electron shell for `pi`, with Playwright E2E coverage organized by test lane.

macOS remains the source of truth for desktop UI verification. Linux is supported for packaging and manual validation, with CI packaging checks to catch AppImage regressions.

## Setup

Install workspace dependencies once:

```bash
corepack enable
pnpm install
```

Build the desktop app:

```bash
pnpm --filter @pi-gui/desktop build
```

Run the app in development:

```bash
pnpm --filter @pi-gui/desktop dev
```

`dev` now runs through `electron-vite`, so renderer edits hot-update in place and Electron `main` / `preload` changes trigger the appropriate reload or restart behavior automatically. The desktop dev launcher also rebuilds the shared workspace packages up front and keeps them in watch mode so Node-side package changes can be picked up without manual rebuilds.

Run the built app locally without packaging:

```bash
pnpm --filter @pi-gui/desktop preview
```

## Pi + fx Runtime

New threads default to Pi. When a compatible fx runtime is available, the Pi/ƒx control to the right of the workspace picker can switch the new thread to fx; only the selected harness is started.

Existing Pi and fx sessions can still be placed side by side. The engine control in the upper-left of each pane identifies the active harness, and selecting the other engine swaps the sessions between panes while preserving their independent runtime, transcript, model, and draft.

| Capability | Pi harness | fx harness |
| --- | --- | --- |
| Runtime | In-process `pi-mono` / `pi-coding-agent` integration | Native fx process over ACP |
| Best at | Full Pi tools, skills, extensions, attachments, queues, steer, and custom/local providers | Independent context, fast parallel review, and native fx provider/session workflows |
| State | Pi session format managed through the thin desktop driver | fx-owned sessions loaded and resumed by fx |
| Authentication | Pi provider configuration | Reuses the user's system fx login when compatible |

Settings → Harnesses shows the native fx connection state for Vercel AI Gateway, OpenAI Codex, and xAI Grok. Connecting a provider runs fx's own browser login command, then restores the previously active provider; the account is activated only when the user selects **Use**. New fx threads initialize their model picker from `fx status --json` and `fx models --json`.

Local OpenAI-compatible providers remain a Pi runtime capability. Available local models are shown alongside fx models for discoverability, but choosing one visibly changes the new-thread harness to Pi. This prevents a local model ID or filesystem path from being submitted through an fx Codex subscription, which Codex rejects.

The app resolves fx in this order so an existing login is reused:

1. `PI_FX_BINARY` (development and tests)
2. `fx` on `PATH`, `~/.fx/bin/fx`, or `~/.local/bin/fx`
3. the architecture-specific fx binary bundled in the app

`pnpm --filter @pi-gui/desktop build` stages the host fx runtime on macOS and Linux. macOS release packaging stages both Apple Silicon and Intel binaries, verifies downloaded release checksums, and includes fx license notices. Upstream fx does not currently publish a Windows runtime, so fx selection is unavailable there. Set `PI_FX_ENABLED=1` only for tests that intentionally exercise the real fx runtime; normal deterministic tests leave it disabled.

Package a Linux AppImage locally:

```bash
pnpm --filter @pi-gui/desktop run package:linux
```

## Windows Updates

The installed NSIS build checks the published GitHub Release feed every four hours. An available version is shown inside the running app; the user starts the download, sees byte and percentage progress, and chooses whether to restart immediately after the update is ready. Session persistence is flushed before `quitAndInstall` runs.

`electron-updater` uses the setup `.blockmap` for differential download when its previous-installer cache and both blockmaps are available. It safely falls back to the complete setup executable when differential prerequisites are missing. The portable executable is a standalone artifact and cannot provide the same reliable in-place replacement contract, so the installed Setup build is recommended for automatic updates.

The release workflow refuses to publish Windows assets unless `latest.yml`, the versioned NSIS setup executable, and its `.blockmap` all exist and match. After every selected platform matrix job succeeds, the draft GitHub Release is published and marked latest.

Live agent tests use your existing `pi` runtime and provider auth. If local `pi` runs do not work, the `live` lane will not be meaningful either.

## Test Lanes

Use the smallest lane that matches the changed surface.

- `core`
  Background-friendly Electron UI coverage. This is the default lane for renderer, sidebar, composer, persistence, settings, skills, and worktree UI behavior.

  ```bash
  pnpm --filter @pi-gui/desktop run test:e2e
  pnpm --filter @pi-gui/desktop run test:e2e:core
  ```

- `live`
  Real runtime/provider coverage. Use this when the change depends on an actual run, transcript item, tool call, or background notification.

  ```bash
  pnpm --filter @pi-gui/desktop run test:e2e:live
  ```

- `native`
  macOS OS-surface coverage such as folder pickers, image pickers, and real clipboard paste. This lane is foreground-only and can take focus.

  ```bash
  pnpm --filter @pi-gui/desktop run test:e2e:native
  ```

- `production`
  Opt-in higher-fidelity smokes that stay out of the default fast lanes. Use these for real-auth `live` checks, packaged `.app` launch, and real macOS open-panel coverage.

  ```bash
  pnpm --filter @pi-gui/desktop run test:prod:real-auth-contract
  pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke
  pnpm --filter @pi-gui/desktop run test:prod:applications-relaunch
  pnpm --filter @pi-gui/desktop run test:prod:release-zip-smoke
  pnpm --filter @pi-gui/desktop run test:prod:open-folder-real
  ```

Run all desktop lanes:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:all
```

For mac-first CI, use:

```bash
pnpm --filter @pi-gui/desktop run test:e2e:ci:mac
```

Linux CI currently validates packaging via:

```bash
pnpm --filter @pi-gui/desktop run package:linux
pnpm --dir apps/desktop run verify:packaged-runtime-deps:linux
```

## Focus And Foreground Rules

- `core` and most `live` scripts set `PI_APP_TEST_MODE=background` for you. Agents normally should not set that env var manually.
- `native` scripts set `PI_APP_TEST_MODE=foreground` for you and may steal focus.
- If a native test fails, rerun it with a clean foreground window before assuming the product is broken.
- Picker tests rely on macOS Accessibility/UI scripting. If folder or image picker automation cannot type into the dialog, check system Accessibility permissions first.
- `production` open-panel coverage also relies on macOS Accessibility/UI scripting and should be run with the app kept frontmost.

## Playwright Vs Computer Use

Prefer the repo lanes first. They are deterministic, scriptable, and the right source of truth for normal development and CI.

- Use `core` when the behavior lives inside the Electron window and should stay background-friendly.
- Use `live` when you need a real run, transcript item, tool call, queued message, or other runtime-backed behavior.
- Use `native` or `production` when the surface is a real macOS dialog, picker, clipboard path, installed `.app`, or packaged release artifact.

Use manual Computer Use smoke only as a complement, not a replacement.

- If the local Codex skill `$pi-gui-computer-use-smoke` is installed, use it for believable release-readiness sweeps on the installed app and for focus-hostile macOS surfaces that are awkward or disruptive in Playwright.
- The reason to use Computer Use is product confidence, not determinism. It is useful when you want to see the real installed app behave correctly while minimizing disruption to the laptop.
- Keep Playwright as the primary regression signal. Computer Use should not replace lane coverage for `core`, `live`, `native`, or `production`, and it should not become a hidden repo dependency.
- Treat real open-folder and native file-picker checks in Computer Use as best-effort smoke coverage unless the workflow is explicitly being validated there.

## Targeted Commands

Use a targeted script while iterating.
Rerun the matching lane before closing for `core` and `live`.
For `native`, rerun the targeted native spec by default and expand to `test:e2e:native` only when the change touches shared native helpers, multiple native specs, or lane-wide native behavior.

```bash
pnpm --filter @pi-gui/desktop run test:core:worktrees
pnpm --filter @pi-gui/desktop run test:core:persistence
pnpm --filter @pi-gui/desktop run test:live:tool-calls
pnpm --filter @pi-gui/desktop run test:native:paste
pnpm --filter @pi-gui/desktop run test:native:open-folder
pnpm --filter @pi-gui/desktop run test:native:attach-image
pnpm --filter @pi-gui/desktop run test:prod:real-auth-contract
pnpm --filter @pi-gui/desktop run test:prod:packaged-smoke
pnpm --filter @pi-gui/desktop run test:prod:applications-relaunch
pnpm --filter @pi-gui/desktop run test:prod:release-zip-smoke
pnpm --filter @pi-gui/desktop run test:prod:open-folder-real
```

For real-auth `live` specs, opt in explicitly:

```bash
PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/absolute/path/to/agent \
  pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/live/submit-run.spec.ts

PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/absolute/path/to/agent \
  pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/live/tool-calls.spec.ts
```

For dev-loop verification, use:

```bash
pnpm --filter @pi-gui/desktop run test:dev:reload
```

That spec launches the app in development mode, edits isolated probe modules for renderer/Electron/shared-package wiring, and proves the running window picks up the changes.

## Test Conventions

- Shared helpers live in [`tests/helpers/electron-app.ts`](./tests/helpers/electron-app.ts). Extend them instead of adding another Electron harness.
- Prefer real clicks, typing, keyboard shortcuts, and visible assertions.
- Avoid direct IPC shortcuts for visible behavior unless the user surface does not exist yet. If you must use one, document why the surface gap exists.
- `pasteTinyPng()` drives the renderer paste handler directly and is appropriate for background-safe coverage.
- `pasteTinyPngViaClipboard()` uses Electron clipboard plus `webContents.paste()` and is appropriate for foreground/native coverage.
- `tests/production/real-auth-contract.spec.ts` proves the default non-real-auth path still seeds a temporary fake-auth agent dir and keeps real-auth coverage opt-in.
- `tests/production/packaged-smoke.spec.ts` proves the packaged `.app` bundle launches and can start a thread through the real UI.
- `tests/production/applications-relaunch.spec.ts` proves an installed copy under `/Applications` launches and relaunches with persisted state.
- `tests/production/release-zip-smoke.spec.ts` proves the packaged release ZIP can be extracted to a temp download-style path and launched through the real UI before publish.
- `tests/production/open-folder-real.spec.ts` proves the real macOS open panel can add a workspace through the empty-state button.

## Lane Map

- `tests/core`: deterministic in-window behavior
- `tests/live`: real agent/runtime behavior
- `tests/native`: macOS OS-surface behavior
- `tests/production`: opt-in higher-fidelity smokes kept out of the default lane globs

Future agents should start by reading this file, `apps/desktop/tests/AGENTS.md`, and the scripts in `apps/desktop/package.json`.
