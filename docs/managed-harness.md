# Managed Pojia Harness

Local development build: 3.0.16. This is not a GitHub release announcement.

Opening the DeepSeek Harness tab installs and starts a managed local instance.
The toolbar shows lifecycle state, the actual loopback port, and a restart action.
Installation shows four phases, download percentage where measurable, an
indeterminate progress bar for npm, and a bounded rolling diagnostic log.

## Installation and Ownership

- Runtime directory: `<Electron userData>/harness`; Tauri uses its own user-data directory.
- Node.js 24.22.1 is downloaded from nodejs.org and checked against pinned SHA-256 hashes. System Node/npm is not required.
- DSH is pinned to `@deepseek-ai/dsh@0.2.1-alpha.1`. Native installation scripts are explicitly allowlisted; unknown scripts fail installation instead of producing an incomplete runtime.
- Only app-managed package files are patched. Other apps, global npm packages and external DSH installations are not modified.
- Installation is staged and locked. Receipts are written after validation. Damaged installations are not accepted as ready; failed staging directories and replaced installations remain available for diagnosis.
- Valid installations are reused on restart without another npm install. First install requires network access; subsequent starts use the local runtime.
- DSH listens only on `127.0.0.1`, with an OS-selected free port. Restart and app quit stop only processes owned by this service.
- `PI_APP_DSH_WEB_URL` is an explicit, loopback-only external-service override. The app connects/reconnects but does not install, patch, or kill the external server. Such servers must support embedded authentication themselves.

## Pojia Source and Adaptation

The supplied `pojia-next` checkout is a prompt-patching utility, not a replacement
DSH server. Its current tree no longer ships the core source. The DSH-only adapter
derives from the public MIT source commit
`536ece244b081d10c49b36f1d8f11247dd0f9050`, with the supplied local `persona.md`.
It does not download the Windows executable, execute its cloud bootstrap,
or scan other AI clients.

`apps/desktop/electron/pojia-dsh.ts` adapts workspace-instruction introductions,
scope text, and both the base and Web overlay persona configuration to the pinned
DSH release. YAML is parsed structurally, original files are preserved beside
modified files, and `pojia-receipt.json` records source revision and file hashes.
The runtime includes `POJIA-LICENSE.txt` with attribution and the full MIT license.
Prompt customization does not guarantee any particular upstream model behavior.

A separate Taosi embedding adaptation changes the managed DSH cookie to
`HttpOnly; SameSite=None; Secure; Partitioned`. Chromium's loopback iframe can retain
authentication without disabling browser security. DSH's signed cookie, launch
token, Host/Origin checks, and unauthorized-request rejection remain intact.
The background readiness probe explicitly exchanges the token for a cookie.

## Data and Credentials

DSH continues to use `DSH_HOME` or `~/.dsh`, preserving its sessions, plugins and
settings. It is not merged into Pi/fx sessions. Existing bidirectional DeepSeek key
synchronization is retained; credentials come only from user environment/stores,
never from the app bundle. Recognized tokens and credentials are redacted from
logs, including split output chunks.

Credential writes use the DSH 0.2.1 version-1 layout (`version: 1` plus
`refs.DEEPSEEK_API_KEY`). Before validating keys over the network, recognized
flat stores and versioned stores polluted by the old top-level key are migrated
under the DSH writer lock. A private `0600` `.credentials.yaml.pre-v1-*.bak`
preserves the original contents. Existing versioned references take precedence
over stray legacy copies; records and unrelated references are preserved.
Unrecognized layouts are not rewritten. Restarting does not create more backups
after successful migration.

## Verification

```sh
pnpm --filter @pi-gui/desktop typecheck
pnpm --filter @pi-gui/desktop build
pnpm --filter @pi-gui/desktop run test:e2e:runner -- tests/unit/dsh-managed-service.spec.ts tests/unit/dsh-web-service.spec.ts tests/core/deepseek-harness.spec.ts
PI_APP_DSH_INSTALL_SMOKE=1 pnpm --filter @pi-gui/desktop run test:e2e:runner -- tests/production/managed-harness.spec.ts
```

The opt-in smoke downloads a real runtime into a fresh test profile, opens the
real Electron tab, verifies actual Harness controls, checks unauthenticated HTTP
remains rejected, restarts the service and confirms the old process exits, then
checks app quit leaves no owned DSH process. Set `PI_APP_DSH_SMOKE_EXECUTABLE` to
target an installed executable. Tests do not submit paid model prompts or alter
the user's sessions/keys when using the fresh-profile smoke.

For an explicitly authorized existing-profile startup check, set
`PI_APP_DSH_EXISTING_USER_DATA` to the real app data directory and run the
`existing user profile` test. This uses `~/.dsh` and `~/.pi/agent`, exercises the
real credential migration and existing plugins, restarts the service, and
reopens the app without sending a model prompt. Existing `ds-bot` profiles can
replace the stock Harness sidebar, so this check verifies the actual input
surface rather than assuming stock button labels.

macOS Electron is the verified desktop surface. Tauri shares the installer and
IPC implementation, but native WebKit embedding and Windows/Linux first-run
behavior require separate platform testing before a cross-platform release.

### Local verification: 2026-10-23

- Desktop typecheck/build, Tauri sidecar build, packaged runtime dependencies, macOS signature verification and packaged secret scan passed.
- DSH unit/credential/core coverage: 32 tests passed, including offline legacy/mixed-layout migration, private backups, idempotence and concurrent-write protection. The installed existing-profile startup/restart/reopen test passed with the user's preserved `ds-bot` plugin.
- Installed fresh-profile smoke passed with a deliberately mixed credential layout: real runtime installation, migration, embedded controls, HTTP 401 for unauthenticated access, service restart, process cleanup, app relaunch and compact-window layout.
- Full core collection was blocked by the existing SDK ESM export import in `runtime-extension-display-name.spec.ts`. An additional navigation/settings run passed two tests but hit selectors assuming one transcript and an immediately visible Harness settings panel. This is not a full-core pass.
- Paid model inference, Tauri native embedding, and Windows/Linux first-run runs were not performed.
