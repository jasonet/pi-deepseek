# Pi GUI plugin integration

Status: working plan for packaging Open Design as a Pi GUI 2.2.4 extension package.

## Goal

Open Design should build a standalone `pi-open-design` package that Pi GUI can discover through its extension/package runtime. Future Open Design updates should be rebuildable into the plugin package without mutating the Pi GUI repository or user workspaces, and Pi GUI should manage install, enable/disable, refresh, and update from its existing Extensions surface.

## Pi GUI 2.2.4 plugin rules observed

Pi GUI loads runtime resources through `@earendil-works/pi-coding-agent`'s `DefaultPackageManager` and `DefaultResourceLoader`, wrapped by `packages/pi-sdk-driver/src/runtime-supervisor.ts`.

Package discovery:

- Package sources are configured in Pi settings as `settings.packages`.
- Source forms:
  - local path: `/path/to/package`
  - npm source: `npm:<package>` or `npm:<package>@<version>`
  - git source: any parseable git URL
- Package `package.json` can expose Pi resources through:

```json
{
  "pi": {
    "extensions": ["./extensions/open-design.js"],
    "skills": [],
    "prompts": [],
    "themes": []
  }
}
```

Extension discovery:

- Explicit `pi.extensions` entries win.
- If no explicit manifest exists, Pi tries `index.ts` or `index.js`, then scans extension-like files.
- A package extension record is surfaced as `RuntimeExtensionRecord` with:
  - `path`
  - `displayName`
  - `enabled`
  - `sourceInfo`
  - `commands`
  - `tools`
  - `flags`
  - `shortcuts`
  - `diagnostics`
- `displayName` comes from package-level `displayName` when available.

Command rules:

- Extensions export a default function receiving `pi`.
- Commands are registered with `pi.registerCommand(name, { description, handler })`.
- Commands appear in Pi GUI slash command discovery and the Extensions detail panel.
- Extension UI supports:
  - `ctx.ui.notify`
  - `ctx.ui.setStatus`
  - `ctx.ui.setWidget`
  - `ctx.ui.confirm`
  - `ctx.ui.select`
  - `ctx.ui.input`
  - `ctx.ui.editor`
  - `ctx.ui.setTitle`
  - `ctx.ui.setEditorText`

Enable/disable rules:

- Pi GUI currently toggles extensions by file path.
- For package resources, toggling edits the matching `settings.packages` entry into object form with extension filters.
- Project package settings win over user package settings for the same package identity.

Update rules already present in Pi runtime:

- `DefaultPackageManager` already implements:
  - `install(source)`
  - `installAndPersist(source)`
  - `remove(source)`
  - `removeAndPersist(source)`
  - `update(source?)`
  - `checkForAvailableUpdates()`
  - `listConfiguredPackages()`
- Update support exists for npm and git package sources.
- Local path sources are not updateable.
- Pinned npm versions and pinned git refs are not auto-updated.
- Npm availability checks use `npm view <name> version --json`.
- Git availability checks compare local HEAD to remote HEAD/upstream.
- `PI_OFFLINE=1` disables install/update checks.

Pi GUI current UI gap:

- The Extensions page can inspect, refresh, enable/disable, and open extension folders.
- It does not yet expose package install/remove/update/check controls.
- App auto-update is separate Electron updater logic and should not be reused for extension package updates.

## Open Design plugin package contract

Generated package shape:

```text
dist/pi-plugin/pi-open-design/
  package.json
  open-design.manifest.json
  extensions/
    open-design.js
```

Required `package.json` fields:

```json
{
  "name": "pi-open-design",
  "displayName": "Open Design",
  "version": "<open-design-version>-pi.<build>",
  "type": "module",
  "piGui": {
    "targetVersion": "2.2.4"
  },
  "openDesign": {
    "version": "<open-design-version>",
    "defaultDaemonUrl": "http://127.0.0.1:7456",
    "defaultWebUrl": "http://127.0.0.1:3000"
  },
  "pi": {
    "extensions": ["./extensions/open-design.js"]
  }
}
```

Required commands for the first bridge:

- `od-status`: check Open Design daemon health/version.
- `od-open`: start or connect to Open Design and show daemon/web URLs.
- `od-create`: create a design brief bridge; later wired to Open Design project/run APIs.

The extension must not import Open Design source directly. It should call Open Design through stable external surfaces:

- `od` CLI for startup.
- daemon HTTP API for project/run/control.
- daemon SSE for run streaming.

## Recommended update channel

For early integration, prefer git source:

```json
{
  "packages": [
    "https://github.com/<owner>/pi-open-design.git"
  ]
}
```

Reasons:

- Pi runtime already supports git update checks and pulls.
- It avoids global npm discovery fallback behavior in Pi GUI.
- It lets Open Design publish plugin-only release branches without coupling to the whole monorepo install.

For broader distribution, publish an npm package later:

```json
{
  "packages": [
    "npm:pi-open-design"
  ]
}
```

Npm is acceptable once Pi GUI exposes package update UI and the npm root fallback behavior is handled cleanly.

## Open Design build requirements

Add a repo-owned build command that:

1. Reads the Open Design version.
2. Generates `dist/pi-plugin/pi-open-design`.
3. Writes plugin `package.json` and `open-design.manifest.json`.
4. Bundles `extensions/open-design.js`.
5. Packs a `.tgz` for manual testing.
6. Validates with Pi GUI's `RuntimeSupervisor` against a temporary workspace/agent dir.
7. Fails if the plugin is not discovered or required commands are missing.

Validation should assert:

- extension display name is `Open Design`
- no diagnostics
- commands include `od-status`, `od-open`, `od-create`
- sourceInfo origin is `package`
- sourceInfo scope is `user` or `temporary`

The build must write only under Open Design ignored output folders such as:

- `dist/pi-plugin/`
- `.tmp/pi-plugin-validate/`

It must not write to:

- Pi GUI repository files
- user `~/.pi`
- user workspace `.pi`

## Pi GUI integration requirements

To let Pi GUI manage this plugin fully, add package-level management over the existing runtime package manager.

Driver/API additions:

- `listRuntimePackages(workspaceId)`
- `installRuntimePackage(workspaceId, source, { local?: boolean })`
- `removeRuntimePackage(workspaceId, source, { local?: boolean })`
- `checkRuntimePackageUpdates(workspaceId)`
- `updateRuntimePackage(workspaceId, source?)`

Desktop IPC additions:

- `pi-gui:list-runtime-packages`
- `pi-gui:install-runtime-package`
- `pi-gui:remove-runtime-package`
- `pi-gui:check-runtime-package-updates`
- `pi-gui:update-runtime-package`

Extensions UI additions:

- Package source list grouped by user/project scope.
- Install source input.
- Update available badge for package-backed extensions.
- Update button per package.
- Refresh runtime after successful install/update/remove.

`RuntimeExtensionRecord` does not currently include package version. Pi GUI can derive version by reading `sourceInfo.baseDir/package.json`, or the driver can extend extension/package records with:

- package name
- package version
- updateable boolean
- package source

## Acceptance harness

Open Design's plugin build should keep using Pi GUI's compiled `RuntimeSupervisor` when available:

```js
import { RuntimeSupervisor } from "/Users/tfwl/Sites/Github/pi-gui/packages/pi-sdk-driver/dist/index.js";
```

The validation harness should:

1. Create temp root.
2. Create temp `agent/settings.json` with `packages: [pluginDir]`.
3. Create temp workspace.
4. Call `getRuntimeSnapshot`.
5. Assert extension and commands.

This mirrors Pi GUI's real extension discovery path without launching Electron.

## Current trial package

A manual trial package was produced at:

```text
dist/pi-plugin/pi-open-design
dist/pi-plugin/pi-open-design-0.9.0-pi.0.tgz
```

It was validated with Pi GUI's `RuntimeSupervisor` and discovered as:

- displayName: `Open Design`
- commands: `od-create`, `od-open`, `od-status`
- diagnostics: none

