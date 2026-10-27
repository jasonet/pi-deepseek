# Managed DSH Trading

The Electron sidebar opens an independent DSH Trading service on an ephemeral
loopback port. Installation is lazy: no Trading service or install runs until
the entry is opened. The toolbar reports installation phases, logs, connection
state and port, and can restart the owned service.

## Ownership

- Source snapshot: `36cc7afe1ccd2fba4d76142873ef6ea400b4128b` from
  `zhu1090093659/dsh-trading`, bundled with a SHA-256 check and license notice.
- First use downloads verified Node 24.22.1 if needed, installs pnpm 11.9.0,
  and builds the source with its locked workspace dependencies and pinned
  DSH 0.2.1-rc.2 host. Network access is required for the initial install.
  The full upstream build retains its build tree; an observed macOS first
  installation occupied about 3.5 GB before profile data and caches.
- Runtime: `<Electron userData>/trading-runtime`. Node is shared with the
  managed Harness runtime, but the DSH host and profile are separate.
- Data: `<Electron userData>/dsh-trading`; research cwd is its `research`
  subdirectory. Neither `~/.dsh` nor a standalone `~/.dsh-trading` is modified.
- The upstream automatic legacy-home migration is disabled for this isolated
  profile; Taosi does not silently import another instance's trading data.
- The service follows Taosi's process lifecycle. A failed install can be retried;
  existing runtime directories are backed up before replacement.
- User market settings stay in the native Trading profile. Taosi startup
  preferences have a separate atomic JSON file; keys are never returned to UI.

## Configuration and Examples

The toolbar gear opens Trading preferences. The market/account button opens
the upstream Trading settings page. Default Pi DeepSeek credentials are synced
locally at service start; restart Trading after changing the Pi key. No bundled
credential is provided, and ambient exchange credentials are not inherited.

First activation prepares a cross-market research draft. Users can choose BTC,
AAPL or 600519 instead, disable initial preparation, or explicitly create a new
example using the toolbar. The bridge never sends a prompt automatically.
Research needs a user-configured model and explicit Send. Source dry-run defaults,
live authorization gates and knowledge-write approvals remain intact.

## Verification

Run the normal desktop build and typecheck, then focused unit/service tests.
The network-dependent Electron first-install smoke is opt-in:

```sh
PI_TRADING_SMOKE=1 PI_APP_TEST_MODE=background pnpm --dir apps/desktop test:e2e:runner -- tests/production/dsh-trading.spec.ts
```

`PI_TRADING_SMOKE_HOME` may select an existing isolated smoke directory;
`PI_TRADING_SMOKE_REUSE=1` explicitly prepares a fresh example for repeat checks.
`PI_TRADING_SMOKE_RUNTIME_SOURCE` links an already-built test runtime into a
new isolated test home to exercise first-profile initialization without rebuilding.
`PI_TRADING_SMOKE_EXECUTABLE` selects a packaged Electron executable.
These variables affect the test only, not production service ownership.

No real order, real-account authorization or paid model response is part of this
smoke. Tauri has no Trading capability advertised in this implementation.
The upstream component is PolyForm Noncommercial, not MIT; review its license
before any public distribution or commercial deployment.
